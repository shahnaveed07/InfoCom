import { expect, test } from '@playwright/test';
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_DEV_URL,
  E2E_INSTRUCTOR_EMAIL,
  E2E_INSTRUCTOR_PASSWORD,
  uniqueSuffix,
} from './helpers/db-env.ts';

test.describe('End-to-End Role Journeys (Public, Admin, Student, Instructor)', () => {
  test('Public Visitor -> Courses -> Detail -> Admission Form Submission', async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto(`${E2E_DEV_URL}/courses`, { waitUntil: 'networkidle' });

    await page.getByRole('link', { name: 'Web Development' }).first().click();
    await expect(page).toHaveURL(/\/courses\/web-development$/);
    await expect(page.getByRole('heading', { name: 'Web Development' })).toBeVisible();

    await page.getByRole('link', { name: /Apply for This Program/i }).click();
    await expect(page).toHaveURL(/\/admissions\?course=crs-igs-web$/);

    await page.locator('#pub-app-name').fill(`Tariq Bhat ${suffix}`);
    await page.locator('#pub-app-email').fill(`tariq.${suffix}@example.org`);
    await page.locator('#pub-app-phone').fill('+91 9906001122');
    await page.locator('#pub-app-address').fill('Downtown Sopore, Baramulla');
    await page.locator('#pub-app-remarks').fill('Morning web cohort inquiry via E2E.');

    await page.getByRole('button', { name: 'Submit Admission Application' }).click();
    await expect(page.getByText('Admission Application Submitted')).toBeVisible();
    await expect(page.getByText(/Application Reference:/i)).toBeVisible();
    await expect(page.locator('strong', { hasText: /ADM-\d{4}-\d+/i })).toBeVisible();
  });

  test('Admin -> Student Onboarding -> Enrollment -> Invoice & Paid Receipt -> Student Setup Login -> Instructor Session, Attendance & Grade', async ({
    browser,
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const studentName = `E2E Learner ${suffix}`;
    const studentEmail = `learner.${suffix}@igs-e2e.local`;
    const newStudentPassword = `Learner!Pass#${suffix}`;
    const sessionTitle = `E2E Web Lab ${suffix}`;

    // =========================================================================
    // 1. ADMIN JOURNEY: Login -> Create Student -> Enroll -> Invoice -> Payment
    // =========================================================================
    await page.goto(`${E2E_DEV_URL}/login`, { waitUntil: 'networkidle' });
    await page.locator('#auth-email').fill(E2E_ADMIN_EMAIL);
    await page.locator('#auth-password').fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).toHaveURL(/\/portal$/);

    // Navigate to Students and create a new student with Single-Use Onboarding Setup Link
    await page.getByRole('button', { name: 'Students', exact: true }).click();
    await page.getByRole('button', { name: /New Student/i }).click();

    await page.locator('#new-stu-name').fill(studentName);
    await page.locator('#new-stu-email').fill(studentEmail);
    await page.locator('#new-stu-phone').fill('+91 9876543210');
    await page.getByRole('button', { name: 'Setup Link', exact: true }).click();
    await page.getByRole('button', { name: 'Create Student', exact: true }).click();

    await expect(page.getByText('Student Onboarding Setup Link')).toBeVisible();
    const setupUrl = await page
      .getByLabel('Student onboarding setup URL')
      .inputValue();
    expect(setupUrl).toContain('setupToken=');

    // Verify backend-generated Student ID (IGS-YYYY-NNNNN) in confirmation notice
    await expect(
      page.getByText(new RegExp(`Student ${studentName} \\(IGS-\\d{4}-\\d+\\) created`, 'i'))
    ).toBeVisible();

    // Enroll the new student into IGS-202 Web Development (Morning Batch · Autumn 2026)
    await page.getByRole('button', { name: 'Enrollments', exact: true }).click();
    await page.getByRole('button', { name: /Enroll Student/i }).click();

    const studentOption = await page
      .locator('#enroll-student option')
      .filter({ hasText: studentName })
      .first()
      .getAttribute('value');
    expect(studentOption).toBeTruthy();

    await page.locator('#enroll-student').selectOption(studentOption!);
    await page.locator('#enroll-course').selectOption('crs-igs-web');
    await page.locator('#enroll-cohort').selectOption('bat-web-aut26');
    await page.locator('#enroll-status').selectOption('Active');

    // Uncheck auto-invoice so we explicitly test Admin Finance invoice creation flow
    const autoInvoiceCheckbox = page.getByLabel(/Automatically issue course tuition fee invoice/i);
    if (await autoInvoiceCheckbox.isChecked()) {
      await autoInvoiceCheckbox.uncheck();
    }
    await page.getByRole('button', { name: 'Confirm Enrollment' }).click();
    await expect(page.getByText('Enrollment recorded.')).toBeVisible();

    // Open Fees & Receipts -> Issue Invoice -> Record Full Payment -> Verify Paid & INR Receipt
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Fees & Receipts', exact: true })
      .click();
    await page.getByRole('button', { name: /Issue Fee Invoice/i }).click();

    await page.locator('#inv-student').selectOption(studentOption!);
    await page.locator('#inv-course').selectOption('crs-igs-web');
    await page.locator('#inv-desc').fill(`E2E Web Tuition ${suffix}`);
    await page.locator('#inv-amount').fill('14000.00');
    await page.getByRole('button', { name: 'Issue Invoice', exact: true }).click();

    const targetRow = page.locator('tr', { hasText: studentName }).filter({
      hasText: `E2E Web Tuition ${suffix}`,
    });
    await expect(targetRow).toBeVisible();
    await expect(targetRow.getByText('Unpaid')).toBeVisible();

    await targetRow.getByRole('button', { name: 'Record Payment' }).click();
    await page.locator('#pay-amount').fill('14000.00');
    await page.locator('#pay-method').selectOption('Bank Transfer');
    await page.locator('#pay-ref').fill(`E2E-UTR-${suffix}`);
    await page.getByRole('button', { name: 'Confirm Payment', exact: true }).click();

    await expect(targetRow.getByText('Paid', { exact: true })).toBeVisible();
    await expect(page.locator('tr', { hasText: `E2E-UTR-${suffix}` })).toBeVisible();
    await expect(page.getByText(/RCPT-/).first()).toBeVisible();
    await expect(targetRow.getByText(/₹14,000\.00/).first()).toBeVisible();
    await expect(targetRow.getByText(/₹14,000\.00/).nth(1)).toBeVisible();

    await page.getByRole('button', { name: /Sign Out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // =========================================================================
    // 2. INSTRUCTOR JOURNEY: Schedule Session -> Mark Attendance -> Enter Grade
    // =========================================================================
    await page.locator('#auth-email').fill(E2E_INSTRUCTOR_EMAIL);
    await page.locator('#auth-password').fill(E2E_INSTRUCTOR_PASSWORD);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).toHaveURL(/\/portal$/);

    // Schedule Class Session on IGS-202 Web Development / Morning Batch · Autumn 2026
    await page.getByRole('button', { name: 'Class Schedules', exact: true }).click();
    await page.getByRole('button', { name: /Schedule Class Session/i }).click();

    await page.locator('#ses-course').selectOption('crs-igs-web');
    await page.locator('#ses-cohort').selectOption('Morning Batch · Autumn 2026');
    await page.locator('#ses-title').fill(sessionTitle);
    await page.locator('#ses-topic').fill('DOM & REST Integration Workshop');
    await page.locator('#ses-room').fill('Software Engineering Lab 2');
    await page.getByRole('button', { name: 'Create Session', exact: true }).click();

    await expect(page.getByText(sessionTitle)).toBeVisible();

    // Mark Attendance for the newly enrolled student
    await page.getByRole('button', { name: 'Attendance & Alerts', exact: true }).click();
    const sessionSelectOption = await page
      .locator('#attendance-session-select option')
      .filter({ hasText: sessionTitle })
      .first()
      .getAttribute('value');
    expect(sessionSelectOption).toBeTruthy();

    await page.locator('#attendance-session-select').selectOption(sessionSelectOption!);
    const attRow = page.locator('tr', { hasText: studentName });
    await expect(attRow).toBeVisible();
    await attRow.getByRole('button', { name: 'Present', exact: true }).click();
    await expect(page.getByText(/Attendance saved as Present/i)).toBeVisible();

    // Enter a Grade in Course Tracking
    await page.getByRole('button', { name: 'Course Tracking', exact: true }).click();
    await page.getByRole('tab', { name: /IGS-202/i }).first().click();

    await page.getByRole('button', { name: `Edit grade for ${studentName} on MOD-1` }).click();
    await page.locator('#grade-score').fill('91');
    await page.locator('#grade-feedback').fill('Strong responsive layout mastery in lab.');
    await page.getByRole('button', { name: 'Save Grade', exact: true }).click();

    await expect(
      page.getByRole('button', { name: `Edit grade for ${studentName} on MOD-1` })
    ).toContainText('91%');

    // Reload and confirm instructor changes persisted in DB
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Course Tracking', exact: true }).click();
    await page.getByRole('tab', { name: /IGS-202/i }).first().click();
    await expect(
      page.getByRole('button', { name: `Edit grade for ${studentName} on MOD-1` })
    ).toContainText('91%');

    await page.getByRole('button', { name: /Sign Out/i }).click();

    // =========================================================================
    // 3. STUDENT JOURNEY: Complete Setup Link -> Sign In -> View Courses, Attendance, Grades & Invoices
    // =========================================================================
    const studentCtx = await browser.newContext();
    const studentPage = await studentCtx.newPage();
    try {
      await studentPage.goto(setupUrl, { waitUntil: 'networkidle' });
      await expect(studentPage.getByRole('tab', { name: 'Reset / Setup Password' })).toHaveAttribute(
        'aria-selected',
        'true'
      );

      await studentPage.locator('#reset-new-password').fill(newStudentPassword);
      await studentPage.locator('#reset-confirm-password').fill(newStudentPassword);
      await studentPage.getByRole('button', { name: 'Apply New Password' }).click();

      await expect(studentPage.getByRole('tab', { name: 'Sign In' })).toHaveAttribute(
        'aria-selected',
        'true'
      );

      await studentPage.locator('#auth-email').fill(studentEmail);
      await studentPage.locator('#auth-password').fill(newStudentPassword);
      await studentPage.getByRole('button', { name: 'Sign In', exact: true }).click();

      await expect(studentPage).toHaveURL(/\/portal$/);
      await expect(studentPage.getByText(studentName).first()).toBeVisible();
      await expect(studentPage.getByText('Web Development').first()).toBeVisible();
      await expect(studentPage.getByText('100%').first()).toBeVisible();
      await expect(studentPage.getByText('91%').first()).toBeVisible();

      await studentPage
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('button', { name: 'Fees & Receipts', exact: true })
        .click();
      await expect(studentPage.getByText(`E2E Web Tuition ${suffix}`)).toBeVisible();
      await expect(studentPage.getByText(/₹14,000\.00/).first()).toBeVisible();
      await expect(studentPage.getByText('Paid', { exact: true }).first()).toBeVisible();
    } finally {
      await studentCtx.close();
    }
  });
});
