import {
  buildAttendanceNotification,
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  computeAdjustmentCents,
  computeCertificateEligibility,
  computeInvoiceStatus,
  formatCents,
  fromCents,
  recalculateInvoiceTotals,
  shouldActivatePortalOnApproval,
  shouldActivatePortalOnPayment,
  toCents,
} from '../../src/shared/academic.ts';
import type {
  AttendanceStatus,
  Course,
  EnrollmentStatus,
  PaymentMethod,
  UserPublic,
} from '../../src/shared/types.ts';
import {
  queueD1TransactionalEmail,
  runD1SessionReminderSweep,
} from '../jobs/d1-worker.ts';
import {
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  WorkflowError,
  d1All,
  d1Batch,
  d1First,
  d1Run,
  d1Stmt,
  getActiveD1,
  inPlaceholders,
  nowIso,
  randomId,
  sqlFixed,
  sqlJson,
} from './client.ts';
import { canInstructorAccessCourseD1 } from './permissions.ts';
import {
  generateNextInvoiceNumberD1,
  generateUniqueReceiptNumberD1,
  generateUniqueRefundNumberD1,
  generateUniqueStudentCodeD1,
  getPortalActivationPolicyD1,
  isActiveStudentCourseDuplicateD1,
  issueAccountSetupTokenD1,
  loadAcademyPoliciesSummaryD1,
  recordAuditLogD1,
} from './ams-service.ts';

export async function notifyApplicantD1(
  params: {
    applicationId: string;
    applicantEmail: string;
    userId?: string | null;
    courseId?: string | null;
    title: string;
    message: string;
  },
  db: D1DatabaseLike = getActiveD1()
): Promise<void> {
  const email = params.applicantEmail.trim().toLowerCase();
  let resolvedUserId = params.userId ?? null;
  if (!resolvedUserId && email) {
    const matched = await d1First<{ id: string }>(
      'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
      [email],
      db
    );
    resolvedUserId = matched?.id ?? null;
  }

  let notificationId: string | null = null;
  const now = nowIso();
  const stmts: D1PreparedStatementLike[] = [];

  if (resolvedUserId) {
    notificationId = randomId('not', 8);
    stmts.push(
      d1Stmt(
        `INSERT INTO notifications
           (id, user_id, kind, title, message, related_course_id, read, created_at)
         VALUES (?, ?, 'admission', ?, ?, ?, 0, ?)`,
        [
          notificationId,
          resolvedUserId,
          params.title,
          params.message,
          params.courseId ?? null,
          now,
        ],
        db
      )
    );
  }

  stmts.push(
    d1Stmt(
      `INSERT INTO delivery_logs
         (id, notification_id, user_id, application_id, channel, recipient, status, sent_at)
       VALUES (?, ?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
      [
        randomId('del', 8),
        notificationId,
        resolvedUserId,
        params.applicationId,
        email || params.applicationId,
        now,
      ],
      db
    )
  );

  await d1Batch(stmts, db);

  if (email && email.includes('@')) {
    await queueD1TransactionalEmail(
      {
        notificationId,
        userId: resolvedUserId,
        applicationId: params.applicationId,
        kind: 'admission',
        recipientEmail: email,
        subject: `${params.title} — IGS — InfoCom Global Services`,
        bodyText: params.message,
      },
      db
    );
  }
}

export async function approveAdmissionWorkflowD1(
  params: {
    admissionId: string;
    actor: UserPublic;
    targetCourseId?: string;
    targetBatchId: string;
    feePlanId?: string | null;
    waitlistIfFull?: boolean;
    reviewRemarks?: string;
    issueInvoice?: boolean;
    appUrl?: string;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const admission = await d1First<Record<string, unknown>>(
    'SELECT * FROM admissions WHERE id = ? LIMIT 1',
    [params.admissionId],
    db
  );
  if (!admission) {
    throw new WorkflowError(404, 'Admission application not found.');
  }

  const admStatus = String(admission.status);
  if (
    admStatus === 'Approved' ||
    admStatus === 'Enrolled' ||
    admStatus === 'Rejected' ||
    admStatus === 'Withdrawn'
  ) {
    throw new WorkflowError(
      409,
      `Application is already in ${admStatus} state and cannot be re-approved.`
    );
  }

  const courseId = params.targetCourseId || String(admission.target_course_id);
  const [course, batch, admDocs] = await Promise.all([
    d1First<Record<string, unknown>>('SELECT * FROM courses WHERE id = ? LIMIT 1', [courseId], db),
    d1First<Record<string, unknown>>(
      'SELECT * FROM cohorts WHERE id = ? LIMIT 1',
      [params.targetBatchId],
      db
    ),
    d1All<{ file_asset_id: string }>(
      'SELECT file_asset_id FROM admission_documents WHERE application_id = ?',
      [params.admissionId],
      db
    ),
  ]);

  if (!course) {
    throw new WorkflowError(400, 'Selected target course was not found.');
  }
  if (!batch || String(batch.course_id) !== String(course.id)) {
    throw new WorkflowError(
      400,
      'Allocated batch does not exist or does not belong to the selected course.'
    );
  }
  const batchStatus = String(batch.status);
  if (batchStatus === 'Archived' || batchStatus === 'Completed') {
    throw new WorkflowError(
      400,
      `Cannot allocate new admission to a ${batchStatus.toLowerCase()} batch.`
    );
  }

  const seatRow = await d1First<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM enrollments
     WHERE course_id = ?
       AND (cohort_id = ? OR cohort = ?)
       AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')`,
    [String(course.id), String(batch.id), String(batch.name)],
    db
  );
  const activeSeatCount = Number(seatRow?.cnt ?? 0);
  const capacity = Number(batch.capacity);

  let enrollmentStatus: 'Active' | 'Waitlisted' = 'Active';
  if (activeSeatCount >= capacity) {
    if (params.waitlistIfFull) {
      enrollmentStatus = 'Waitlisted';
    } else {
      throw new WorkflowError(
        409,
        `Batch ${String(batch.name)} is at full capacity (${activeSeatCount}/${capacity}). Select another batch or choose Waitlist if Full.`
      );
    }
  }

  const studentEmail = String(admission.applicant_email || '').trim().toLowerCase();
  if (!studentEmail) {
    throw new WorkflowError(400, 'Applicant email is required before approving an application.');
  }

  const [courseInst, batchInst, activationPolicy, existingStudent] = await Promise.all([
    d1First<{ name: string }>('SELECT name FROM users WHERE id = ? LIMIT 1', [String(course.instructor_id)], db),
    d1First<{ name: string }>('SELECT name FROM users WHERE id = ? LIMIT 1', [String(batch.instructor_id)], db),
    getPortalActivationPolicyD1(db),
    d1First<Record<string, unknown>>('SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1', [studentEmail], db),
  ]);

  if (existingStudent && String(existingStudent.role) !== 'student') {
    throw new WorkflowError(
      409,
      `An existing ${String(existingStudent.role)} account already uses ${studentEmail}. Use a unique applicant email.`
    );
  }

  const activateNow = shouldActivatePortalOnApproval(activationPolicy);
  const now = nowIso();

  let studentId: string;
  let studentName: string;
  let studentCode: string;
  let studentFinalStatus: string;
  let studentProfileId = '';
  let issuedOnboarding: { rawToken: string; onboardingPath: string; expiresAt: string } | null = null;

  if (!existingStudent) {
    studentId = randomId('stu', 8);
    studentName = String(admission.applicant_name || '') || studentEmail.split('@')[0];
    studentCode = await generateUniqueStudentCodeD1(db);
    studentFinalStatus = activateNow ? 'active' : 'inactive';

    const fullAddress = [admission.address, admission.city, admission.postal_code]
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .join(', ');
    const emergencyContact = [
      String(admission.guardian_name || '').trim(),
      String(admission.guardian_relationship || '').trim()
        ? `(${String(admission.guardian_relationship).trim()})`
        : '',
      String(admission.guardian_phone || '').trim(),
    ]
      .filter(Boolean)
      .join(' ');

    const roleRow = await d1First<{ id: string }>(
      "SELECT id FROM roles WHERE code = 'student' LIMIT 1",
      [],
      db
    );

    const createUserStmts: D1PreparedStatementLike[] = [
      d1Stmt(
        `INSERT INTO users
           (id, name, email, role, status, student_code, phone, password_hash, must_change_password, session_version, created_at, updated_at)
         VALUES (?, ?, ?, 'student', ?, ?, ?, NULL, 1, 1, ?, ?)`,
        [
          studentId,
          studentName,
          studentEmail,
          studentFinalStatus,
          studentCode,
          admission.phone ? String(admission.phone) : null,
          now,
          now,
        ],
        db
      ),
    ];

    if (roleRow) {
      createUserStmts.push(
        d1Stmt(
          `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_by_user_id, assigned_at)
           VALUES (?, ?, ?, ?, ?)`,
          [`ur-${studentId}-student`, studentId, roleRow.id, params.actor.id, now],
          db
        )
      );
    }

    studentProfileId = `sp-${studentId}`;
    createUserStmts.push(
      d1Stmt(
        `INSERT INTO student_profiles
           (id, user_id, student_code, department_id, date_of_birth, address, emergency_contact, enrollment_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          studentProfileId,
          studentId,
          studentCode,
          course.department_id ?? null,
          admission.date_of_birth ?? null,
          fullAddress,
          emergencyContact,
          now,
          now,
          now,
        ],
        db
      )
    );

    await d1Batch(createUserStmts, db);

    const tok = await issueAccountSetupTokenD1(
      { userId: studentId, createdByUserId: params.actor.id, expiresInHours: 72 },
      db
    );
    issuedOnboarding = {
      rawToken: tok.rawToken,
      onboardingPath: `/?enrollToken=${encodeURIComponent(tok.rawToken)}`,
      expiresAt: tok.expiresAtIso,
    };
  } else {
    studentId = String(existingStudent.id);
    studentName = String(existingStudent.name);
    studentCode = existingStudent.student_code
      ? String(existingStudent.student_code)
      : await generateUniqueStudentCodeD1(db);
    studentFinalStatus =
      activateNow && String(existingStudent.status) === 'inactive'
        ? 'active'
        : String(existingStudent.status);

    await d1Run(
      'UPDATE users SET student_code = ?, status = ?, updated_at = ? WHERE id = ?',
      [studentCode, studentFinalStatus, now, studentId],
      db
    );

    const existingProf = await d1First<{ id: string }>(
      'SELECT id FROM student_profiles WHERE user_id = ? LIMIT 1',
      [studentId],
      db
    );
    if (existingProf) {
      studentProfileId = existingProf.id;
    } else {
      studentProfileId = `sp-${studentId}`;
      const addr = [admission.address, admission.city, admission.postal_code]
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .join(', ');
      await d1Run(
        `INSERT INTO student_profiles
           (id, user_id, student_code, department_id, date_of_birth, address, enrollment_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          studentProfileId,
          studentId,
          studentCode,
          course.department_id ?? null,
          admission.date_of_birth ?? null,
          addr,
          now,
          now,
          now,
        ],
        db
      );
    }
  }

  const guardianName = String(admission.guardian_name || '').trim();
  if (guardianName) {
    const existingGuardian = await d1First<{ id: string }>(
      'SELECT id FROM guardians WHERE student_profile_id = ? AND full_name = ? LIMIT 1',
      [studentProfileId, guardianName],
      db
    );
    if (!existingGuardian) {
      await d1Run(
        `INSERT INTO guardians
           (id, student_profile_id, full_name, relationship, email, phone, is_primary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          randomId('grd', 8),
          studentProfileId,
          guardianName,
          String(admission.guardian_relationship || '').trim() || 'Guardian',
          String(admission.guardian_email || '').trim(),
          String(admission.guardian_phone || '').trim(),
          now,
          now,
        ],
        db
      );
    }
  }

  const dupEnr = await d1First<{ status: string }>(
    `SELECT status FROM enrollments
     WHERE student_id = ? AND course_id = ? AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')
     LIMIT 1`,
    [studentId, String(course.id)],
    db
  );
  if (dupEnr) {
    throw new WorkflowError(
      409,
      `${studentName} already has a ${dupEnr.status.toLowerCase()} enrollment in ${String(course.code)}.`
    );
  }

  // Fee Plan & Fee Structure resolution
  let feePlan: Record<string, unknown> | null = null;
  const reqFeePlanId = params.feePlanId || (admission.fee_plan_id ? String(admission.fee_plan_id) : null);
  if (reqFeePlanId) {
    feePlan = await d1First<Record<string, unknown>>(
      'SELECT * FROM fee_plans WHERE id = ? LIMIT 1',
      [reqFeePlanId],
      db
    );
  }
  if (!feePlan) {
    feePlan = await d1First<Record<string, unknown>>(
      'SELECT * FROM fee_plans WHERE is_active = 1 ORDER BY code ASC LIMIT 1',
      [],
      db
    );
  }

  const feeStruct = await d1First<Record<string, unknown>>(
    'SELECT * FROM fee_structures WHERE course_id = ? AND is_active = 1 ORDER BY effective_from DESC LIMIT 1',
    [String(course.id)],
    db
  );

  const tuitionAmountStr = feeStruct
    ? sqlFixed(feeStruct.tuition_amount, '0.00')
    : sqlFixed(course.tuition_fee, '0.00');
  const tuitionCents = toCents(tuitionAmountStr);
  const regCents = feeStruct ? toCents(sqlFixed(feeStruct.registration_fee, '0.00')) : 0;
  const labCents = feeStruct ? toCents(sqlFixed(feeStruct.lab_fee, '0.00')) : 0;
  const totalFeeCents = tuitionCents + regCents + labCents;

  const enrollmentId = randomId('enr', 8);
  const portalIsActive = studentFinalStatus === 'active';
  const batchStmts: D1PreparedStatementLike[] = [];

  batchStmts.push(
    d1Stmt(
      `INSERT INTO enrollments
         (id, student_id, course_id, cohort_id, cohort, status, enrolled_at, completed_module_ids,
          tuition_snapshot, batch_name_snapshot, instructor_name_snapshot, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
      [
        enrollmentId,
        studentId,
        String(course.id),
        String(batch.id),
        String(batch.name),
        enrollmentStatus,
        now,
        sqlFixed(course.tuition_fee, '0.00'),
        String(batch.name),
        batchInst?.name ?? courseInst?.name ?? null,
        now,
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO enrollment_histories
         (id, enrollment_id, previous_status, new_status, previous_batch_id, new_batch_id, reason, changed_by_user_id, changed_at)
       VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)`,
      [
        randomId('eh', 8),
        enrollmentId,
        enrollmentStatus,
        String(batch.id),
        `Allocated upon admission approval (${String(admission.application_number || admission.id)})`,
        params.actor.id,
        now,
      ],
      db
    )
  );

  let invoiceId: string | null = null;
  if (params.issueInvoice !== false && totalFeeCents > 0) {
    const academyRow = await d1First<{ currency: string }>(
      'SELECT currency FROM academies ORDER BY created_at ASC LIMIT 1',
      [],
      db
    );
    invoiceId = randomId('inv', 8);
    const invNum = await generateNextInvoiceNumberD1(db);
    const totalDueStr = fromCents(totalFeeCents);
    const planLabel = feePlan ? ` · ${String(feePlan.name)}` : '';
    const invDesc = `${String(course.code)} ${String(course.title)} Tuition (${String(batch.name)}${planLabel})`;
    const currency = academyRow?.currency || (feePlan?.currency ? String(feePlan.currency) : 'INR');
    const dueIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    batchStmts.push(
      d1Stmt(
        `INSERT INTO fee_invoices
           (id, invoice_number, student_id, enrollment_id, course_id, fee_structure_id, description,
            subtotal, discount_total, scholarship_total, amount_due, amount_paid, currency, status,
            due_date, issued_by_user_id, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0.00', '0.00', ?, '0.00', ?, 'Unpaid', ?, ?, 0, ?, ?)`,
        [
          invoiceId,
          invNum,
          studentId,
          enrollmentId,
          String(course.id),
          feeStruct ? String(feeStruct.id) : null,
          invDesc,
          totalDueStr,
          totalDueStr,
          currency,
          dueIso,
          params.actor.id,
          now,
          now,
        ],
        db
      )
    );

    if (tuitionCents > 0) {
      batchStmts.push(
        d1Stmt(
          `INSERT INTO invoice_items (id, invoice_id, item_type, description, quantity, unit_price, line_total, created_at)
           VALUES (?, ?, 'Tuition', ?, 1, ?, ?, ?)`,
          [
            randomId('item', 8),
            invoiceId,
            `${String(course.code)} Tuition (${String(batch.name)})`,
            tuitionAmountStr,
            tuitionAmountStr,
            now,
          ],
          db
        )
      );
    }
    if (regCents > 0) {
      const regStr = fromCents(regCents);
      batchStmts.push(
        d1Stmt(
          `INSERT INTO invoice_items (id, invoice_id, item_type, description, quantity, unit_price, line_total, created_at)
           VALUES (?, ?, 'Registration', 'Admission Registration Fee', 1, ?, ?, ?)`,
          [randomId('item', 8), invoiceId, regStr, regStr, now],
          db
        )
      );
    }
    if (labCents > 0) {
      const labStr = fromCents(labCents);
      batchStmts.push(
        d1Stmt(
          `INSERT INTO invoice_items (id, invoice_id, item_type, description, quantity, unit_price, line_total, created_at)
           VALUES (?, ?, 'Lab', 'Laboratory & Compute Sandbox Fee', 1, ?, ?, ?)`,
          [randomId('item', 8), invoiceId, labStr, labStr, now],
          db
        )
      );
    }
  }

  const docAssetIds = admDocs.map((d) => d.file_asset_id);
  if (docAssetIds.length > 0) {
    batchStmts.push(
      d1Stmt(
        `UPDATE documents SET owner_user_id = ? WHERE id IN (${inPlaceholders(docAssetIds.length)})`,
        [studentId, ...docAssetIds],
        db
      )
    );
  }

  batchStmts.push(
    d1Stmt(
      `UPDATE admissions
       SET status = 'Approved',
           target_course_id = ?,
           target_batch_id = COALESCE(target_batch_id, ?),
           allocated_batch_id = ?,
           fee_plan_id = ?,
           preferred_cohort = ?,
           converted_user_id = ?,
           reviewed_by_user_id = ?,
           review_remarks = ?,
           reviewed_at = ?,
           approved_at = ?,
           portal_activated = ?,
           portal_activated_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        String(course.id),
        String(batch.id),
        String(batch.id),
        feePlan ? String(feePlan.id) : null,
        String(batch.name),
        studentId,
        params.actor.id,
        params.reviewRemarks ?? String(admission.review_remarks || ''),
        now,
        now,
        portalIsActive ? 1 : 0,
        portalIsActive ? now : null,
        now,
        String(admission.id),
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO admission_status_histories
         (id, application_id, previous_status, new_status, reason, actor_user_id, actor_name, actor_role, changed_at)
       VALUES (?, ?, ?, 'Approved', ?, ?, ?, ?, ?)`,
      [
        randomId('ash', 8),
        String(admission.id),
        admStatus,
        params.reviewRemarks?.trim() ||
          `Approved and allocated to ${String(course.code)} · ${String(batch.name)} (${enrollmentStatus})`,
        params.actor.id,
        params.actor.name,
        params.actor.role,
        now,
      ],
      db
    )
  );

  await d1Batch(batchStmts, db);

  await notifyApplicantD1(
    {
      applicationId: String(admission.id),
      applicantEmail: studentEmail,
      userId: studentId,
      courseId: String(course.id),
      title: `Admission Approved · ${String(course.code)}`,
      message: `Congratulations ${studentName}! Your application (${String(admission.application_number || admission.id)}) is approved for ${String(course.title)} (${String(batch.name)}, status: ${enrollmentStatus}). Student ID: ${studentCode}.`,
    },
    db
  );

  await notifyApplicantD1(
    {
      applicationId: String(admission.id),
      applicantEmail: studentEmail,
      userId: studentId,
      courseId: String(course.id),
      title: `Enrollment Confirmed · ${String(batch.name)}`,
      message: `Enrollment created in ${String(course.code)} (${String(batch.name)}).${portalIsActive ? ' Your student portal access is active.' : ` Portal activation is pending (${activationPolicy.replace(/_/g, ' ')} policy).`}`,
    },
    db
  );

  if (issuedOnboarding && portalIsActive) {
    const origin = (params.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
    await queueD1TransactionalEmail(
      {
        userId: studentId,
        applicationId: String(admission.id),
        kind: 'account_setup',
        recipientEmail: studentEmail,
        subject: 'Set Up Your Student Portal Password — IGS — InfoCom Global Services',
        bodyText: `Hello ${studentName},\n\nYour student account (${studentCode}) has been activated. Complete your password setup using the link below (valid for 72 hours):\n${origin}${issuedOnboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
        bypassPreferences: true,
        redactSensitive: true,
      },
      db
    );
  }

  await recordAuditLogD1(
    {
      actor: params.actor,
      action: 'ADMISSION_APPROVED',
      entityType: 'admission',
      entityId: String(admission.id),
      summary: `Approved admission ${String(admission.application_number || admission.id)} for ${studentName} (${studentCode}) -> ${String(course.code)} / ${String(batch.name)}.`,
      metadata: {
        studentId,
        enrollmentId,
        invoiceId,
        portalActivated: portalIsActive,
        policy: activationPolicy,
      },
    },
    db
  );

  return {
    admissionId: String(admission.id),
    applicationNumber: admission.application_number ? String(admission.application_number) : null,
    studentId,
    studentName,
    studentCode,
    enrollmentId,
    enrollmentStatus,
    invoiceId,
    courseCode: String(course.code),
    batchName: String(batch.name),
    portalActivated: portalIsActive,
    portalActivationPolicy: activationPolicy,
    ...(issuedOnboarding
      ? {
          onboardingToken: issuedOnboarding.rawToken,
          onboardingPath: issuedOnboarding.onboardingPath,
          onboardingExpiresAt: issuedOnboarding.expiresAt,
        }
      : {}),
  };
}

export async function createEnrollmentWithOptionalInvoiceD1(
  params: {
    actor: UserPublic;
    studentId: string;
    courseId: string;
    cohortId?: string;
    cohort: string;
    status: EnrollmentStatus;
    issueTuitionInvoice: boolean;
    waitlistIfFull?: boolean;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const [student, course] = await Promise.all([
    d1First<{ id: string; name: string; email: string; status: string }>(
      "SELECT id, name, email, status FROM users WHERE id = ? AND role = 'student' LIMIT 1",
      [params.studentId],
      db
    ),
    d1First<Record<string, unknown>>('SELECT * FROM courses WHERE id = ? LIMIT 1', [params.courseId], db),
  ]);

  if (!student || !course) {
    return { ok: false as const, status: 400, error: 'Selected student or course does not exist.' };
  }
  if (student.status === 'archived' || student.status === 'suspended') {
    return {
      ok: false as const,
      status: 400,
      error: `Cannot enroll a ${student.status} student account.`,
    };
  }
  if (params.actor.role === 'instructor') {
    const assigned = await canInstructorAccessCourseD1(params.actor.id, String(course.id), db);
    if (!assigned) {
      return {
        ok: false as const,
        status: 403,
        error: 'You are not assigned to enroll students into this course.',
      };
    }
  }

  const dup = await isActiveStudentCourseDuplicateD1(params.studentId, params.courseId, db);
  if (dup) {
    return {
      ok: false as const,
      status: 409,
      error: 'Student already has an active or waitlisted enrollment in this course.',
    };
  }

  let matchedBatch: Record<string, unknown> | null = null;
  if (params.cohortId) {
    matchedBatch = await d1First<Record<string, unknown>>(
      'SELECT * FROM cohorts WHERE id = ? LIMIT 1',
      [params.cohortId],
      db
    );
    if (!matchedBatch || String(matchedBatch.course_id) !== params.courseId) {
      return {
        ok: false as const,
        status: 400,
        error: 'Selected batch cohort does not belong to this course.',
      };
    }
  } else {
    matchedBatch = await d1First<Record<string, unknown>>(
      'SELECT * FROM cohorts WHERE course_id = ? AND name = ? LIMIT 1',
      [params.courseId, params.cohort],
      db
    );
  }

  let effectiveStatus: EnrollmentStatus = params.status;
  if (matchedBatch && effectiveStatus === 'Active') {
    const capRow = await d1First<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM enrollments
       WHERE course_id = ? AND (cohort_id = ? OR cohort = ?)
         AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')`,
      [params.courseId, String(matchedBatch.id), String(matchedBatch.name)],
      db
    );
    const activeCount = Number(capRow?.cnt ?? 0);
    if (activeCount >= Number(matchedBatch.capacity)) {
      if (params.waitlistIfFull) {
        effectiveStatus = 'Waitlisted';
      } else {
        return {
          ok: false as const,
          status: 409,
          error: `Batch ${String(matchedBatch.name)} is at full capacity (${activeCount}/${Number(matchedBatch.capacity)}).`,
        };
      }
    }
  }

  const courseInst = await d1First<{ name: string }>(
    'SELECT name FROM users WHERE id = ? LIMIT 1',
    [String(course.instructor_id)],
    db
  );

  const enrollmentId = randomId('enr', 8);
  const resolvedCohortId = matchedBatch ? String(matchedBatch.id) : params.cohortId ?? null;
  const resolvedCohortName = matchedBatch ? String(matchedBatch.name) : params.cohort;
  const tuitionStr = sqlFixed(course.tuition_fee, '0.00');
  const now = nowIso();
  const notifId = randomId('not', 8);

  const stmts: D1PreparedStatementLike[] = [
    d1Stmt(
      `INSERT INTO enrollments
         (id, student_id, course_id, cohort_id, cohort, status, enrolled_at, completed_module_ids,
          tuition_snapshot, batch_name_snapshot, instructor_name_snapshot, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
      [
        enrollmentId,
        params.studentId,
        params.courseId,
        resolvedCohortId,
        resolvedCohortName,
        effectiveStatus,
        now,
        tuitionStr,
        resolvedCohortName,
        courseInst?.name ?? null,
        now,
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO enrollment_histories
         (id, enrollment_id, previous_status, new_status, new_batch_id, reason, changed_by_user_id, changed_at)
       VALUES (?, ?, NULL, ?, ?, 'Enrollment created by academy staff', ?, ?)`,
      [randomId('eh', 8), enrollmentId, effectiveStatus, resolvedCohortId, params.actor.id, now],
      db
    ),
    d1Stmt(
      `INSERT INTO notifications
         (id, user_id, kind, title, message, related_course_id, read, created_at)
       VALUES (?, ?, 'enrollment', ?, ?, ?, 0, ?)`,
      [
        notifId,
        params.studentId,
        `Enrollment Confirmed · ${String(course.code)}`,
        `You were enrolled in ${String(course.title)} (${resolvedCohortName}) with status ${effectiveStatus}.`,
        String(course.id),
        now,
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO delivery_logs
         (id, notification_id, user_id, channel, recipient, status, sent_at)
       VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
      [randomId('del', 8), notifId, student.id, student.email, now],
      db
    ),
  ];

  let invoiceEmailParams: { invNum: string; formattedFee: string; desc: string; dueDateStr: string } | null = null;
  if (params.issueTuitionInvoice && toCents(tuitionStr) > 0) {
    const [feeStruct, acadRow, invNum] = await Promise.all([
      d1First<{ id: string }>(
        'SELECT id FROM fee_structures WHERE course_id = ? AND is_active = 1 LIMIT 1',
        [String(course.id)],
        db
      ),
      d1First<{ currency: string }>('SELECT currency FROM academies ORDER BY created_at ASC LIMIT 1', [], db),
      generateNextInvoiceNumberD1(db),
    ]);
    const invId = randomId('inv', 8);
    const desc = `${String(course.code)} ${String(course.title)} Tuition (${resolvedCohortName})`;
    const invoiceCurrency = acadRow?.currency || 'INR';
    const dueIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    stmts.push(
      d1Stmt(
        `INSERT INTO fee_invoices
           (id, invoice_number, student_id, enrollment_id, course_id, fee_structure_id, description,
            subtotal, discount_total, scholarship_total, amount_due, amount_paid, currency, status,
            due_date, issued_by_user_id, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0.00', '0.00', ?, '0.00', ?, 'Unpaid', ?, ?, 0, ?, ?)`,
        [
          invId,
          invNum,
          params.studentId,
          enrollmentId,
          String(course.id),
          feeStruct?.id ?? null,
          desc,
          tuitionStr,
          tuitionStr,
          invoiceCurrency,
          dueIso,
          params.actor.id,
          now,
          now,
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO invoice_items (id, invoice_id, item_type, description, quantity, unit_price, line_total, created_at)
         VALUES (?, ?, 'Tuition', ?, 1, ?, ?, ?)`,
        [randomId('item', 8), invId, desc, tuitionStr, tuitionStr, now],
        db
      )
    );

    invoiceEmailParams = {
      invNum,
      formattedFee: formatCents(toCents(tuitionStr), invoiceCurrency),
      desc,
      dueDateStr: dueIso.slice(0, 10),
    };
  }

  await d1Batch(stmts, db);

  await queueD1TransactionalEmail(
    {
      notificationId: notifId,
      userId: student.id,
      kind: 'enrollment',
      recipientEmail: student.email,
      subject: `Enrollment Confirmed · ${String(course.code)} — IGS — InfoCom Global Services`,
      bodyText: `You were enrolled in ${String(course.title)} (${resolvedCohortName}) with status ${effectiveStatus}.`,
    },
    db
  );

  if (invoiceEmailParams) {
    await queueD1TransactionalEmail(
      {
        userId: student.id,
        kind: 'finance',
        recipientEmail: student.email,
        subject: `Tuition Invoice Issued · ${invoiceEmailParams.invNum} — IGS — InfoCom Global Services`,
        bodyText: `Invoice ${invoiceEmailParams.invNum} for ${invoiceEmailParams.formattedFee} (${invoiceEmailParams.desc}) has been issued with due date ${invoiceEmailParams.dueDateStr}.`,
      },
      db
    );
  }

  await recordAuditLogD1(
    {
      actor: params.actor,
      action: 'ENROLLMENT_CREATED',
      entityType: 'enrollment',
      entityId: enrollmentId,
      summary: `Enrolled ${student.name} in ${String(course.code)} (${resolvedCohortName}).`,
    },
    db
  );

  await runD1SessionReminderSweep(db).catch(() => undefined);
  return { ok: true as const, enrollmentId };
}

export async function recordInvoicePaymentD1(
  params: {
    actor: UserPublic;
    invoiceId: string;
    amount: string;
    method: PaymentMethod;
    referenceCode: string;
    notes: string;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const invoice = await d1First<Record<string, unknown>>(
    `SELECT fi.*, u.email AS student_email, u.status AS student_status
     FROM fee_invoices fi
     LEFT JOIN users u ON u.id = fi.student_id
     WHERE fi.id = ? LIMIT 1`,
    [params.invoiceId],
    db
  );
  if (!invoice) {
    return { ok: false as const, status: 404, error: 'Invoice not found.' };
  }
  if (String(invoice.status) === 'Voided' || Number(invoice.is_archived) === 1) {
    return {
      ok: false as const,
      status: 400,
      error: 'Cannot record payment on a voided or archived invoice.',
    };
  }

  const currency = String(invoice.currency || 'INR');
  const dueCents = toCents(sqlFixed(invoice.amount_due));
  const paidCents = toCents(sqlFixed(invoice.amount_paid));
  const payCents = toCents(params.amount);
  const remainingCents = dueCents - paidCents;

  if (payCents <= 0) {
    return { ok: false as const, status: 400, error: 'Payment amount must be positive.' };
  }
  if (payCents > remainingCents) {
    return {
      ok: false as const,
      status: 400,
      error: `Payment exceeds remaining balance (${formatCents(remainingCents, currency)}).`,
    };
  }

  const newPaidStr = fromCents(paidCents + payCents);
  const newStatus = computeInvoiceStatus(sqlFixed(invoice.amount_due), newPaidStr);
  const paymentId = randomId('pay', 8);
  const receiptNumber = await generateUniqueReceiptNumberD1(db);
  const formattedPay = fromCents(payCents);
  const studentId = String(invoice.student_id);
  const studentEmail = invoice.student_email ? String(invoice.student_email) : '';
  const now = nowIso();
  const notifId = randomId('not', 8);
  const notifTitle = `Payment Receipt · ${receiptNumber}`;
  const notifMsg = `Payment of ${formatCents(payCents, currency)} via ${params.method} applied to invoice ${String(invoice.invoice_number)}. Status: ${newStatus}.`;

  const stmts: D1PreparedStatementLike[] = [
    d1Stmt(
      `INSERT INTO payments
         (id, receipt_number, invoice_id, student_id, amount, method, reference_code, recorded_by_user_id, notes, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentId,
        receiptNumber,
        String(invoice.id),
        studentId,
        formattedPay,
        params.method,
        params.referenceCode,
        params.actor.id,
        params.notes,
        now,
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount, allocated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [randomId('alloc', 8), paymentId, String(invoice.id), formattedPay, now],
      db
    ),
    d1Stmt(
      'UPDATE fee_invoices SET amount_paid = ?, status = ?, updated_at = ? WHERE id = ?',
      [newPaidStr, newStatus, now, String(invoice.id)],
      db
    ),
    d1Stmt(
      `INSERT INTO notifications
         (id, user_id, kind, title, message, related_course_id, read, created_at)
       VALUES (?, ?, 'finance', ?, ?, ?, 0, ?)`,
      [notifId, studentId, notifTitle, notifMsg, String(invoice.course_id), now],
      db
    ),
    d1Stmt(
      `INSERT INTO delivery_logs
         (id, notification_id, user_id, channel, recipient, status, sent_at)
       VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
      [randomId('del', 8), notifId, studentId, studentEmail || studentId, now],
      db
    ),
  ];

  let portalAutoActivated = false;
  const activationPolicy = await getPortalActivationPolicyD1(db);
  if (
    shouldActivatePortalOnPayment(activationPolicy) &&
    String(invoice.student_status) === 'inactive'
  ) {
    const pendingAdmission = await d1First<{ id: string }>(
      `SELECT id FROM admissions
       WHERE converted_user_id = ?
         AND status IN ('Approved', 'Enrolled', 'Accepted')
         AND portal_activated = 0
       LIMIT 1`,
      [studentId],
      db
    );
    if (pendingAdmission) {
      const actNotifId = randomId('not', 8);
      stmts.push(
        d1Stmt("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?", [now, studentId], db),
        d1Stmt(
          'UPDATE admissions SET portal_activated = 1, portal_activated_at = ?, updated_at = ? WHERE converted_user_id = ? AND portal_activated = 0',
          [now, now, studentId],
          db
        ),
        d1Stmt(
          `INSERT INTO notifications
             (id, user_id, kind, title, message, related_course_id, read, created_at)
           VALUES (?, ?, 'admission', 'Student Portal Activated', ?, ?, 0, ?)`,
          [
            actNotifId,
            studentId,
            `Your student portal access is now active following payment receipt ${receiptNumber}.`,
            String(invoice.course_id),
            now,
          ],
          db
        ),
        d1Stmt(
          `INSERT INTO delivery_logs
             (id, notification_id, user_id, application_id, channel, recipient, status, sent_at)
           VALUES (?, ?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
          [randomId('del', 8), actNotifId, studentId, pendingAdmission.id, studentEmail || studentId, now],
          db
        )
      );
      portalAutoActivated = true;
    }
  }

  await d1Batch(stmts, db);

  if (studentEmail) {
    await queueD1TransactionalEmail(
      {
        notificationId: notifId,
        userId: studentId,
        kind: 'finance',
        recipientEmail: studentEmail,
        subject: `${notifTitle} — IGS — InfoCom Global Services`,
        bodyText: notifMsg,
      },
      db
    );
  }

  await recordAuditLogD1(
    {
      actor: params.actor,
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: paymentId,
      summary: `Recorded ${formatCents(payCents, currency)} payment (${receiptNumber}) on ${String(invoice.invoice_number)} -> ${newStatus}.`,
    },
    db
  );

  if (portalAutoActivated) {
    await recordAuditLogD1(
      {
        actor: params.actor,
        action: 'PORTAL_AUTO_ACTIVATED_ON_PAYMENT',
        entityType: 'user',
        entityId: studentId,
        summary: `Automatically activated student portal access after payment ${receiptNumber} per academy policy.`,
      },
      db
    );
  }

  return {
    ok: true as const,
    paymentId,
    receiptNumber,
    newStatus,
    invoiceNumber: String(invoice.invoice_number),
    currency,
    payCents,
    portalAutoActivated,
    studentId,
  };
}

export async function applyInvoiceAdjustmentD1(
  params: {
    actor: UserPublic;
    invoiceId: string;
    kind: 'discount' | 'scholarship';
    targetId: string;
    notes?: string;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const invoice = await d1First<Record<string, unknown>>(
    `SELECT fi.*, u.email AS student_email
     FROM fee_invoices fi
     LEFT JOIN users u ON u.id = fi.student_id
     WHERE fi.id = ? LIMIT 1`,
    [params.invoiceId],
    db
  );
  if (!invoice) {
    return { ok: false as const, status: 404, error: 'Invoice not found.' };
  }
  if (String(invoice.status) === 'Voided' || Number(invoice.is_archived) === 1) {
    return {
      ok: false as const,
      status: 400,
      error: 'Cannot apply adjustments to a voided or archived invoice.',
    };
  }
  if (String(invoice.status) === 'Paid') {
    return {
      ok: false as const,
      status: 409,
      error: 'Cannot apply a discount or scholarship to an already paid invoice.',
    };
  }

  const subtotalCents = toCents(sqlFixed(invoice.subtotal ?? invoice.amount_due));
  const existingDiscountCents = toCents(sqlFixed(invoice.discount_total));
  const existingScholarshipCents = toCents(sqlFixed(invoice.scholarship_total));
  const currentDueCents = toCents(sqlFixed(invoice.amount_due));
  const paidCents = toCents(sqlFixed(invoice.amount_paid));
  const remainingPayableCents = Math.max(0, currentDueCents - paidCents);

  if (remainingPayableCents <= 0) {
    return {
      ok: false as const,
      status: 409,
      error: 'Invoice has no remaining balance eligible for reduction.',
    };
  }

  let label = '';
  let adjustmentCents = 0;
  const nowMs = Date.now();

  if (params.kind === 'discount') {
    const discount = await d1First<Record<string, unknown>>(
      'SELECT * FROM discounts WHERE id = ? LIMIT 1',
      [params.targetId],
      db
    );
    if (!discount || Number(discount.is_active) !== 1) {
      return {
        ok: false as const,
        status: 400,
        error: 'Selected discount is inactive or not found.',
      };
    }
    if (discount.valid_from && Date.parse(String(discount.valid_from)) > nowMs) {
      return {
        ok: false as const,
        status: 400,
        error: 'Discount validity period has not started yet.',
      };
    }
    if (discount.valid_to && Date.parse(String(discount.valid_to)) < nowMs) {
      return { ok: false as const, status: 400, error: 'Discount has expired.' };
    }
    adjustmentCents = computeAdjustmentCents({
      baseCents: subtotalCents,
      type: String(discount.discount_type) as 'Percentage' | 'Fixed',
      value: sqlFixed(discount.value),
      maxAllowedCents: remainingPayableCents,
    });
    label = `Discount (${String(discount.code)}): ${String(discount.name)}`;
  } else {
    const scholarship = await d1First<Record<string, unknown>>(
      'SELECT * FROM scholarships WHERE id = ? LIMIT 1',
      [params.targetId],
      db
    );
    if (!scholarship || Number(scholarship.is_active) !== 1) {
      return {
        ok: false as const,
        status: 400,
        error: 'Selected scholarship is inactive or not found.',
      };
    }
    adjustmentCents = computeAdjustmentCents({
      baseCents: subtotalCents,
      type: String(scholarship.coverage_type) as 'Percentage' | 'Fixed',
      value: sqlFixed(scholarship.coverage_value),
      maxAllowedCents: remainingPayableCents,
    });
    label = `Scholarship (${String(scholarship.code)}): ${String(scholarship.name)}`;
  }

  if (adjustmentCents <= 0) {
    return { ok: false as const, status: 400, error: 'Calculated adjustment amount is zero.' };
  }

  const newDiscountCents =
    params.kind === 'discount' ? existingDiscountCents + adjustmentCents : existingDiscountCents;
  const newScholarshipCents =
    params.kind === 'scholarship'
      ? existingScholarshipCents + adjustmentCents
      : existingScholarshipCents;

  const { netDueCents, status: newStatus } = recalculateInvoiceTotals({
    subtotalCents,
    discountTotalCents: newDiscountCents,
    scholarshipTotalCents: newScholarshipCents,
    paidCents,
  });

  const negativeStr = `-${fromCents(adjustmentCents)}`;
  const lineDesc = params.notes?.trim() ? `${label} — ${params.notes.trim()}` : label;
  const currency = String(invoice.currency || 'INR');
  const formattedAdj = formatCents(adjustmentCents, currency);
  const now = nowIso();
  const notifId = randomId('not', 8);
  const studentId = String(invoice.student_id);

  await d1Batch(
    [
      d1Stmt(
        `INSERT INTO invoice_items (id, invoice_id, item_type, description, quantity, unit_price, line_total, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          randomId('item', 8),
          String(invoice.id),
          params.kind === 'discount' ? 'Discount' : 'Scholarship',
          lineDesc,
          negativeStr,
          negativeStr,
          now,
        ],
        db
      ),
      d1Stmt(
        `UPDATE fee_invoices
         SET subtotal = ?, discount_total = ?, scholarship_total = ?, amount_due = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        [
          fromCents(subtotalCents),
          fromCents(newDiscountCents),
          fromCents(newScholarshipCents),
          fromCents(netDueCents),
          newStatus,
          now,
          String(invoice.id),
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO notifications
           (id, user_id, kind, title, message, related_course_id, read, created_at)
         VALUES (?, ?, 'finance', ?, ?, ?, 0, ?)`,
        [
          notifId,
          studentId,
          `${params.kind === 'discount' ? 'Fee Discount' : 'Scholarship'} Applied · ${String(invoice.invoice_number)}`,
          `${label} (-${formattedAdj}) was applied to invoice ${String(invoice.invoice_number)}. Updated balance due: ${formatCents(Math.max(0, netDueCents - paidCents), currency)}.`,
          String(invoice.course_id),
          now,
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO delivery_logs
           (id, notification_id, user_id, channel, recipient, status, sent_at)
         VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
        [
          randomId('del', 8),
          notifId,
          studentId,
          invoice.student_email ? String(invoice.student_email) : studentId,
          now,
        ],
        db
      ),
    ],
    db
  );

  await recordAuditLogD1(
    {
      actor: params.actor,
      action:
        params.kind === 'discount' ? 'INVOICE_DISCOUNT_APPLIED' : 'INVOICE_SCHOLARSHIP_APPLIED',
      entityType: 'fee_invoice',
      entityId: String(invoice.id),
      summary: `Applied ${label} (-${formattedAdj}) to ${String(invoice.invoice_number)} -> ${newStatus}.`,
    },
    db
  );

  return {
    ok: true as const,
    invoiceId: String(invoice.id),
    invoiceNumber: String(invoice.invoice_number),
    adjustmentCents,
    formattedAdj,
    newStatus,
    label,
  };
}

export async function processPaymentRefundD1(
  params: {
    actor: UserPublic;
    paymentId: string;
    amount: string;
    reason: string;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const payment = await d1First<Record<string, unknown>>(
    `SELECT p.*, fi.invoice_number, fi.course_id, fi.amount_due, fi.amount_paid, fi.currency,
            fi.status AS invoice_status, fi.is_archived AS invoice_archived,
            u.email AS student_email
     FROM payments p
     INNER JOIN fee_invoices fi ON fi.id = p.invoice_id
     LEFT JOIN users u ON u.id = p.student_id
     WHERE p.id = ? LIMIT 1`,
    [params.paymentId],
    db
  );
  if (!payment) {
    return { ok: false as const, status: 404, error: 'Payment receipt not found.' };
  }
  if (String(payment.invoice_status) === 'Voided' || Number(payment.invoice_archived) === 1) {
    return {
      ok: false as const,
      status: 400,
      error: 'Cannot refund a payment belonging to a voided or archived invoice.',
    };
  }

  const priorRefunds = await d1All<{ amount: string; status: string }>(
    "SELECT amount, status FROM refunds WHERE payment_id = ? AND status != 'Cancelled'",
    [params.paymentId],
    db
  );
  const paymentAmt = sqlFixed(payment.amount);
  const priorRefundedCents = priorRefunds.reduce((sum, r) => sum + toCents(sqlFixed(r.amount)), 0);
  const refundableCents = Math.max(0, toCents(paymentAmt) - priorRefundedCents);
  const refundCents = toCents(params.amount);
  const currency = String(payment.currency || 'INR');

  if (refundCents <= 0) {
    return { ok: false as const, status: 400, error: 'Refund amount must be positive.' };
  }
  if (refundCents > refundableCents) {
    return {
      ok: false as const,
      status: 400,
      error: `Refund exceeds refundable payment balance (${formatCents(refundableCents, currency)}).`,
    };
  }

  const paidCents = toCents(sqlFixed(payment.amount_paid));
  const newPaidCents = Math.max(0, paidCents - refundCents);
  const newPaidStr = fromCents(newPaidCents);
  const newStatus = computeInvoiceStatus(sqlFixed(payment.amount_due), newPaidStr);
  const refundId = randomId('ref', 8);
  const refundNumber = await generateUniqueRefundNumberD1(db);
  const formattedRefund = fromCents(refundCents);
  const displayAmt = formatCents(refundCents, currency);
  const studentId = String(payment.student_id);
  const now = nowIso();
  const notifId = randomId('not', 8);

  await d1Batch(
    [
      d1Stmt(
        `INSERT INTO refunds
           (id, refund_number, payment_id, invoice_id, student_id, amount, reason, status, processed_by_user_id, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Processed', ?, ?)`,
        [
          refundId,
          refundNumber,
          String(payment.id),
          String(payment.invoice_id),
          studentId,
          formattedRefund,
          params.reason,
          params.actor.id,
          now,
        ],
        db
      ),
      d1Stmt(
        'UPDATE fee_invoices SET amount_paid = ?, status = ?, updated_at = ? WHERE id = ?',
        [newPaidStr, newStatus, now, String(payment.invoice_id)],
        db
      ),
      d1Stmt(
        `INSERT INTO notifications
           (id, user_id, kind, title, message, related_course_id, read, created_at)
         VALUES (?, ?, 'finance', ?, ?, ?, 0, ?)`,
        [
          notifId,
          studentId,
          `Refund Processed · ${refundNumber}`,
          `A refund of ${displayAmt} against receipt ${String(payment.receipt_number)} (${String(payment.invoice_number)}) was processed: ${params.reason}`,
          String(payment.course_id),
          now,
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO delivery_logs
           (id, notification_id, user_id, channel, recipient, status, sent_at)
         VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
        [
          randomId('del', 8),
          notifId,
          studentId,
          payment.student_email ? String(payment.student_email) : studentId,
          now,
        ],
        db
      ),
    ],
    db
  );

  await recordAuditLogD1(
    {
      actor: params.actor,
      action: 'PAYMENT_REFUNDED',
      entityType: 'refund',
      entityId: refundId,
      summary: `Processed refund ${refundNumber} (${displayAmt}) on receipt ${String(payment.receipt_number)} (${String(payment.invoice_number)} -> ${newStatus}).`,
    },
    db
  );

  return {
    ok: true as const,
    refundId,
    refundNumber,
    displayAmt,
    receiptNumber: String(payment.receipt_number),
    invoiceNumber: String(payment.invoice_number),
    newStatus,
  };
}

export async function issueVerifiedCertificateD1(
  params: {
    actor: UserPublic;
    studentId: string;
    courseId: string;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  if (params.actor.role === 'instructor') {
    const allowed = await canInstructorAccessCourseD1(params.actor.id, params.courseId, db);
    if (!allowed) {
      return {
        ok: false as const,
        status: 403,
        error: 'You are not assigned to issue certificates for this course.',
      };
    }
  }

  const [student, course] = await Promise.all([
    d1First<Record<string, unknown>>(
      "SELECT * FROM users WHERE id = ? AND role = 'student' LIMIT 1",
      [params.studentId],
      db
    ),
    d1First<Record<string, unknown>>('SELECT * FROM courses WHERE id = ? LIMIT 1', [params.courseId], db),
  ]);

  if (!student || !course) {
    return { ok: false as const, status: 404, error: 'Student or course not found.' };
  }

  const enrollment = await d1First<Record<string, unknown>>(
    `SELECT * FROM enrollments
     WHERE student_id = ? AND course_id = ? AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')
     LIMIT 1`,
    [String(student.id), String(course.id)],
    db
  );
  if (!enrollment) {
    return { ok: false as const, status: 400, error: 'Student is not enrolled in this course.' };
  }

  const existingCert = await d1First<Record<string, unknown>>(
    'SELECT * FROM certificates WHERE student_id = ? AND course_id = ? LIMIT 1',
    [String(student.id), String(course.id)],
    db
  );
  if (existingCert && String(existingCert.status) === 'Issued') {
    return {
      ok: false as const,
      status: 409,
      error: `Certificate ${String(existingCert.certificate_code)} has already been issued for this course.`,
    };
  }

  const [policies, mods, assessments, grades, att, template, prefixSetting] = await Promise.all([
    loadAcademyPoliciesSummaryD1(db),
    d1All<Record<string, unknown>>('SELECT * FROM course_modules WHERE course_id = ?', [String(course.id)], db),
    d1All<Record<string, unknown>>('SELECT * FROM assessments WHERE course_id = ?', [String(course.id)], db),
    d1All<Record<string, unknown>>(
      'SELECT * FROM module_grades WHERE student_id = ? AND course_id = ?',
      [String(student.id), String(course.id)],
      db
    ),
    d1All<Record<string, unknown>>(
      'SELECT * FROM attendance_records WHERE student_id = ? AND course_id = ?',
      [String(student.id), String(course.id)],
      db
    ),
    d1First<Record<string, unknown>>(
      'SELECT * FROM certificate_templates WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1',
      [],
      db
    ),
    d1First<{ value: string }>(
      "SELECT value FROM academy_settings WHERE key = 'certificate.code_prefix' LIMIT 1",
      [],
      db
    ),
  ]);

  const completedIds = sqlJson<string[]>(enrollment.completed_module_ids, []);
  const completionPct = calculateCourseCompletion(completedIds, mods.length);

  const eligibleAssessments = assessments.filter(
    (a) => !a.batch_id || String(a.batch_id) === String(enrollment.cohort_id || '')
  );
  const gradedAssessmentPairs = eligibleAssessments
    .map((a) => {
      const g = grades.find((gr) => String(gr.assessment_id) === String(a.id));
      if (!g) return null;
      const pct = Math.round((Number(g.score) / Math.max(1, Number(a.max_score))) * 1000) / 10;
      return { score: pct, weight: Number(a.weight) };
    })
    .filter((x): x is { score: number; weight: number } => x !== null);

  const weightedScore =
    gradedAssessmentPairs.length > 0
      ? calculateWeightedAverage(gradedAssessmentPairs)
      : calculateWeightedAverage(
          mods
            .map((m) => {
              const g = grades.find((gr) => String(gr.module_id) === String(m.id));
              return g ? { score: Number(g.score), weight: Number(m.weight) } : null;
            })
            .filter((x): x is { score: number; weight: number } => x !== null)
        );

  const attendanceStats = calculateAttendanceStats(
    att.map((a) => ({
      id: String(a.id),
      sessionId: String(a.session_id),
      courseId: String(a.course_id),
      studentId: String(a.student_id),
      status: String(a.status) as AttendanceStatus,
      note: String(a.note || ''),
      updatedAt: String(a.updated_at),
      updatedBy: String(a.updated_by),
    })),
    { lateWeightPct: policies.lateWeightPct }
  );

  const minCourseScore = Number(course.passing_score ?? 60);
  const minCourseAttendance = Number(course.min_attendance_rate ?? 75);

  const eligibility = computeCertificateEligibility({
    enrollmentStatus: String(enrollment.status) as EnrollmentStatus,
    completionPct,
    weightedScore,
    attendanceRate: attendanceStats.rate,
    minCompletionPct:
      policies.certificateMinCompletionPct ??
      (template ? Number(template.min_completion_pct) : 100),
    minScore:
      minCourseScore > policies.certificateMinScore
        ? minCourseScore
        : policies.certificateMinScore,
    minAttendancePct:
      minCourseAttendance > policies.certificateMinAttendancePct
        ? minCourseAttendance
        : policies.certificateMinAttendancePct,
  });

  if (!eligibility.eligible || weightedScore === null) {
    return {
      ok: false as const,
      status: 400,
      error: `Student is not eligible for certification: ${eligibility.reasons.join(' ')}`,
    };
  }

  const letterGrade = calculateLetterGrade(weightedScore);
  const certPrefix = prefixSetting?.value || 'INF-CERT-2026';
  const randFour = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
  const certCode = `${certPrefix}-${String(course.code).replace(/[^A-Z0-9]/g, '')}-${randFour}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `${certCode}:${String(student.id)}:${String(course.id)}:${weightedScore.toFixed(2)}`
    )
  );
  const verificationHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
    .toUpperCase();

  const certId = existingCert ? String(existingCert.id) : randomId('cert', 8);
  const now = nowIso();
  const notifId = randomId('not', 8);
  const stmts: D1PreparedStatementLike[] = [];

  if (existingCert) {
    stmts.push(
      d1Stmt(
        `UPDATE certificates
         SET certificate_code = ?, verification_hash = ?, template_id = ?, final_score = ?,
             letter_grade = ?, attendance_rate = ?, issued_by_user_id = ?, issued_by_name = ?,
             course_title_snapshot = ?, status = 'Issued', revoked_reason = NULL, issued_at = ?
         WHERE id = ?`,
        [
          certCode,
          verificationHash,
          template ? String(template.id) : null,
          weightedScore.toFixed(2),
          letterGrade,
          attendanceStats.rate,
          params.actor.id,
          params.actor.name,
          String(course.title),
          now,
          certId,
        ],
        db
      )
    );
  } else {
    stmts.push(
      d1Stmt(
        `INSERT INTO certificates
           (id, certificate_code, verification_hash, student_id, course_id, enrollment_id, template_id,
            final_score, letter_grade, attendance_rate, issued_by_user_id, issued_by_name,
            course_title_snapshot, status, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Issued', ?)`,
        [
          certId,
          certCode,
          verificationHash,
          String(student.id),
          String(course.id),
          String(enrollment.id),
          template ? String(template.id) : null,
          weightedScore.toFixed(2),
          letterGrade,
          attendanceStats.rate,
          params.actor.id,
          params.actor.name,
          String(course.title),
          now,
        ],
        db
      )
    );
  }

  if (String(enrollment.status) !== 'Completed') {
    stmts.push(
      d1Stmt("UPDATE enrollments SET status = 'Completed', updated_at = ? WHERE id = ?", [now, String(enrollment.id)], db),
      d1Stmt(
        `INSERT INTO enrollment_histories
           (id, enrollment_id, previous_status, new_status, reason, changed_by_user_id, changed_at)
         VALUES (?, ?, ?, 'Completed', ?, ?, ?)`,
        [
          randomId('eh', 8),
          String(enrollment.id),
          String(enrollment.status),
          `Certificate ${certCode} issued`,
          params.actor.id,
          now,
        ],
        db
      )
    );
  }

  stmts.push(
    d1Stmt(
      `INSERT INTO notifications
         (id, user_id, kind, title, message, related_course_id, read, created_at)
       VALUES (?, ?, 'certificate', ?, ?, ?, 0, ?)`,
      [
        notifId,
        String(student.id),
        `Certificate Issued · ${String(course.code)}`,
        `Congratulations! Official certificate ${certCode} has been issued for ${String(course.title)} (Final Grade: ${weightedScore}% ${letterGrade}).`,
        String(course.id),
        now,
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO delivery_logs
         (id, notification_id, user_id, channel, recipient, status, sent_at)
       VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
      [randomId('del', 8), notifId, String(student.id), String(student.email), now],
      db
    )
  );

  await d1Batch(stmts, db);

  await recordAuditLogD1(
    {
      actor: params.actor,
      action: 'CERTIFICATE_ISSUED',
      entityType: 'certificate',
      entityId: certId,
      summary: `Issued verified certificate ${certCode} to ${String(student.name)} for ${String(course.code)}.`,
    },
    db
  );

  return { ok: true as const, certificateCode: certCode };
}

export async function markAttendanceAndNotifyD1(
  params: {
    actor: UserPublic;
    sessionId: string;
    studentId: string;
    status: AttendanceStatus;
    note: string;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const session = await d1First<Record<string, unknown>>(
    'SELECT * FROM class_sessions WHERE id = ? LIMIT 1',
    [params.sessionId],
    db
  );
  if (!session) return { ok: false as const, status: 404, error: 'Session not found.' };

  if (params.actor.role === 'instructor') {
    const assigned = await canInstructorAccessCourseD1(params.actor.id, String(session.course_id), db);
    if (!assigned && String(session.instructor_id || '') !== params.actor.id) {
      return {
        ok: false as const,
        status: 403,
        error: 'You are not authorized to mark attendance for this session.',
      };
    }
  }

  const [course, student] = await Promise.all([
    d1First<Record<string, unknown>>('SELECT * FROM courses WHERE id = ? LIMIT 1', [String(session.course_id)], db),
    d1First<{ id: string; name: string; email: string }>(
      "SELECT id, name, email FROM users WHERE id = ? AND role = 'student' LIMIT 1",
      [params.studentId],
      db
    ),
  ]);
  if (!course || !student) {
    return { ok: false as const, status: 404, error: 'Course or student not found.' };
  }

  const enrollment = await d1First<{ id: string }>(
    `SELECT id FROM enrollments
     WHERE student_id = ? AND course_id = ? AND cohort = ?
       AND status IN ('Active', 'Completed', 'Waitlisted')
     LIMIT 1`,
    [student.id, String(course.id), String(session.cohort)],
    db
  );
  if (!enrollment) {
    return {
      ok: false as const,
      status: 400,
      error: 'Student does not have an active enrollment in this session cohort.',
    };
  }

  const prev = await d1First<{ status: string; note: string }>(
    'SELECT status, note FROM attendance_records WHERE session_id = ? AND student_id = ? LIMIT 1',
    [String(session.id), student.id],
    db
  );

  const now = nowIso();
  const trimmedNote = params.note.trim();
  const notifData = buildAttendanceNotification({
    id: randomId('not', 8),
    studentId: student.id,
    course: {
      id: String(course.id),
      code: String(course.code),
      title: String(course.title),
      track: String(course.track),
      instructorId: String(course.instructor_id),
      instructorName: params.actor.name,
      durationWeeks: Number(course.duration_weeks),
      tuitionFee: sqlFixed(course.tuition_fee),
      modules: [],
    },
    session: {
      id: String(session.id),
      courseId: String(session.course_id),
      cohort: String(session.cohort),
      title: String(session.title),
      topic: String(session.topic || ''),
      room: String(session.room),
      instructorName: String(session.instructor_name),
      startIso: String(session.start_at),
      endIso: String(session.end_at),
    },
    status: params.status,
    note: trimmedNote,
    createdAt: now,
  });

  await d1Batch(
    [
      d1Stmt(
        `INSERT INTO attendance_records
           (id, session_id, course_id, enrollment_id, student_id, status, note, updated_at, updated_by_user_id, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, student_id) DO UPDATE SET
           status = excluded.status,
           note = excluded.note,
           enrollment_id = excluded.enrollment_id,
           updated_at = excluded.updated_at,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_by = excluded.updated_by`,
        [
          randomId('att', 8),
          String(session.id),
          String(course.id),
          enrollment.id,
          student.id,
          params.status,
          trimmedNote,
          now,
          params.actor.id,
          params.actor.name,
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO notifications
           (id, user_id, kind, title, message, related_course_id, related_session_id, read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          notifData.id,
          notifData.userId,
          notifData.kind,
          notifData.title,
          notifData.message,
          notifData.relatedCourseId ?? null,
          notifData.relatedSessionId ?? null,
          now,
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO delivery_logs
           (id, notification_id, user_id, channel, recipient, status, sent_at)
         VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
        [randomId('del', 8), notifData.id, student.id, student.email, now],
        db
      ),
    ],
    db
  );

  await queueD1TransactionalEmail(
    {
      notificationId: notifData.id,
      userId: student.id,
      kind: 'attendance',
      recipientEmail: student.email,
      subject: `${notifData.title} — IGS — InfoCom Global Services`,
      bodyText: notifData.message,
    },
    db
  );

  await recordAuditLogD1(
    {
      actor: params.actor,
      action: 'ATTENDANCE_RECORDED',
      entityType: 'attendance',
      entityId: `${String(session.id)}:${student.id}`,
      summary: prev
        ? `Updated ${student.name} attendance from ${prev.status} to ${params.status} for "${String(session.title)}".`
        : `Marked ${student.name} as ${params.status} for "${String(session.title)}".`,
      metadata: {
        sessionId: String(session.id),
        studentId: student.id,
        studentName: student.name,
        previousStatus: prev?.status ?? null,
        newStatus: params.status,
        previousNote: prev?.note ?? '',
        newNote: trimmedNote,
      },
    },
    db
  );

  return { ok: true as const };
}

export async function bulkMarkAttendanceAndNotifyD1(
  params: {
    actor: UserPublic;
    sessionId: string;
    entries: Array<{ studentId: string; status: AttendanceStatus; note: string }>;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const session = await d1First<Record<string, unknown>>(
    'SELECT * FROM class_sessions WHERE id = ? LIMIT 1',
    [params.sessionId],
    db
  );
  if (!session) return { ok: false as const, status: 404, error: 'Session not found.' };

  if (params.actor.role === 'instructor') {
    const assigned = await canInstructorAccessCourseD1(params.actor.id, String(session.course_id), db);
    if (!assigned && String(session.instructor_id || '') !== params.actor.id) {
      return {
        ok: false as const,
        status: 403,
        error: 'You are not authorized to mark attendance for this session.',
      };
    }
  }

  const course = await d1First<Record<string, unknown>>(
    'SELECT * FROM courses WHERE id = ? LIMIT 1',
    [String(session.course_id)],
    db
  );
  if (!course) return { ok: false as const, status: 404, error: 'Course not found.' };

  const deduplicated = new Map<string, { studentId: string; status: AttendanceStatus; note: string }>();
  for (const entry of params.entries) {
    deduplicated.set(entry.studentId, {
      studentId: entry.studentId,
      status: entry.status,
      note: entry.note.trim(),
    });
  }
  const targetIds = Array.from(deduplicated.keys());
  if (targetIds.length === 0) return { ok: true as const, updatedCount: 0 };

  const ph = inPlaceholders(targetIds.length);
  const [enrollments, students, existingRecords] = await Promise.all([
    d1All<{ id: string; student_id: string }>(
      `SELECT id, student_id FROM enrollments
       WHERE student_id IN (${ph}) AND course_id = ? AND cohort = ?
         AND status IN ('Active', 'Completed', 'Waitlisted')`,
      [...targetIds, String(course.id), String(session.cohort)],
      db
    ),
    d1All<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE id IN (${ph}) AND role = 'student'`,
      targetIds,
      db
    ),
    d1All<{ student_id: string; status: string; note: string }>(
      `SELECT student_id, status, note FROM attendance_records WHERE session_id = ? AND student_id IN (${ph})`,
      [String(session.id), ...targetIds],
      db
    ),
  ]);

  const enrollmentMap = new Map(enrollments.map((e) => [e.student_id, e]));
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const existingMap = new Map(existingRecords.map((r) => [r.student_id, r]));

  for (const sid of targetIds) {
    if (!studentMap.has(sid) || !enrollmentMap.has(sid)) {
      return {
        ok: false as const,
        status: 400,
        error: `Student ${sid} does not have an active enrollment in this session cohort.`,
      };
    }
  }

  const changedEntries = Array.from(deduplicated.values()).filter((entry) => {
    const prev = existingMap.get(entry.studentId);
    if (!prev) return true;
    return prev.status !== entry.status || (prev.note ?? '') !== entry.note;
  });

  if (changedEntries.length === 0) {
    return { ok: true as const, updatedCount: 0 };
  }

  const now = nowIso();
  const mappedCourse: Course = {
    id: String(course.id),
    code: String(course.code),
    title: String(course.title),
    track: String(course.track),
    instructorId: String(course.instructor_id),
    instructorName: params.actor.name,
    durationWeeks: Number(course.duration_weeks),
    tuitionFee: sqlFixed(course.tuition_fee),
    modules: [],
  };
  const mappedSession = {
    id: String(session.id),
    courseId: String(session.course_id),
    cohort: String(session.cohort),
    title: String(session.title),
    topic: String(session.topic || ''),
    room: String(session.room),
    instructorName: String(session.instructor_name),
    startIso: String(session.start_at),
    endIso: String(session.end_at),
  };

  const stmts: D1PreparedStatementLike[] = [];
  const emailQueueList: Array<{ notifId: string; studentId: string; email: string; title: string; message: string }> = [];

  for (const entry of changedEntries) {
    const student = studentMap.get(entry.studentId)!;
    const enrollment = enrollmentMap.get(entry.studentId)!;
    const notifData = buildAttendanceNotification({
      id: randomId('not', 8),
      studentId: student.id,
      course: mappedCourse,
      session: mappedSession,
      status: entry.status,
      note: entry.note,
      createdAt: now,
    });

    stmts.push(
      d1Stmt(
        `INSERT INTO attendance_records
           (id, session_id, course_id, enrollment_id, student_id, status, note, updated_at, updated_by_user_id, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, student_id) DO UPDATE SET
           status = excluded.status,
           note = excluded.note,
           enrollment_id = excluded.enrollment_id,
           updated_at = excluded.updated_at,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_by = excluded.updated_by`,
        [
          randomId('att', 8),
          String(session.id),
          String(course.id),
          enrollment.id,
          student.id,
          entry.status,
          entry.note,
          now,
          params.actor.id,
          params.actor.name,
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO notifications
           (id, user_id, kind, title, message, related_course_id, related_session_id, read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          notifData.id,
          notifData.userId,
          notifData.kind,
          notifData.title,
          notifData.message,
          notifData.relatedCourseId ?? null,
          notifData.relatedSessionId ?? null,
          now,
        ],
        db
      ),
      d1Stmt(
        `INSERT INTO delivery_logs
           (id, notification_id, user_id, channel, recipient, status, sent_at)
         VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
        [randomId('del', 8), notifData.id, student.id, student.email, now],
        db
      )
    );

    emailQueueList.push({
      notifId: notifData.id,
      studentId: student.id,
      email: student.email,
      title: notifData.title,
      message: notifData.message,
    });
  }

  await d1Batch(stmts, db);

  for (const eq of emailQueueList) {
    await queueD1TransactionalEmail(
      {
        notificationId: eq.notifId,
        userId: eq.studentId,
        kind: 'attendance',
        recipientEmail: eq.email,
        subject: `${eq.title} — IGS — InfoCom Global Services`,
        bodyText: eq.message,
      },
      db
    );
  }

  for (const entry of changedEntries) {
    const student = studentMap.get(entry.studentId)!;
    const prev = existingMap.get(entry.studentId);
    await recordAuditLogD1(
      {
        actor: params.actor,
        action: 'ATTENDANCE_BULK_RECORDED',
        entityType: 'attendance',
        entityId: `${String(session.id)}:${student.id}`,
        summary: prev
          ? `Bulk updated ${student.name} attendance from ${prev.status} to ${entry.status} for "${String(session.title)}".`
          : `Bulk marked ${student.name} as ${entry.status} for "${String(session.title)}".`,
        metadata: {
          sessionId: String(session.id),
          studentId: student.id,
          studentName: student.name,
          previousStatus: prev?.status ?? null,
          newStatus: entry.status,
          previousNote: prev?.note ?? '',
          newNote: entry.note,
        },
      },
      db
    );
  }

  return { ok: true as const, updatedCount: changedEntries.length };
}

export async function listSessionAttendanceHistoryD1(
  sessionId: string,
  db: D1DatabaseLike = getActiveD1()
) {
  const logs = await d1All<Record<string, unknown>>(
    `SELECT * FROM audit_logs
     WHERE entity_type = 'attendance' AND (entity_id = ? OR entity_id LIKE ?)
     ORDER BY created_at DESC LIMIT 60`,
    [sessionId, `${sessionId}:%`],
    db
  );

  return logs.map((log) => {
    const meta = sqlJson<Record<string, unknown>>(log.metadata, {});
    const [, sidFromEntity] = String(log.entity_id).split(':');
    return {
      id: String(log.id),
      sessionId: typeof meta.sessionId === 'string' ? meta.sessionId : sessionId,
      studentId: typeof meta.studentId === 'string' ? meta.studentId : sidFromEntity ?? '',
      studentName: typeof meta.studentName === 'string' ? meta.studentName : 'Student',
      previousStatus:
        typeof meta.previousStatus === 'string'
          ? (meta.previousStatus as AttendanceStatus)
          : null,
      newStatus:
        typeof meta.newStatus === 'string'
          ? (meta.newStatus as AttendanceStatus)
          : ('Present' as AttendanceStatus),
      previousNote: typeof meta.previousNote === 'string' ? meta.previousNote : '',
      newNote: typeof meta.newNote === 'string' ? meta.newNote : '',
      actorName: String(log.actor_email),
      actorRole: String(log.actor_role),
      createdAt: String(log.created_at),
    };
  });
}
