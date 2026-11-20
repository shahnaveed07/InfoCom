import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Edit3,
  Fingerprint,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { UserPublic, WebAuthnCredentialMetadata } from '../shared/types';
import { api } from '../utils/api';
import {
  createPasskeyCredential,
  formatWebAuthnError,
  getPasskeyAssertion,
  isBrowserWebAuthnSupported,
} from '../utils/webauthn';

interface PasskeyManagementModalProps {
  user: UserPublic;
  onClose: () => void;
}

export function PasskeyManagementModal({ user, onClose }: PasskeyManagementModalProps) {
  const [credentials, setCredentials] = useState<WebAuthnCredentialMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [registering, setRegistering] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const supported = isBrowserWebAuthnSupported();

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listMyPasskeys();
      setCredentials(res.credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load registered passkeys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  async function handleAddPasskey(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!supported) {
      setError('This browser does not support WebAuthn passkeys.');
      return;
    }

    const label = deviceLabel.trim() || 'Additional Passkey';
    setRegistering(true);
    try {
      const opts = await api.webauthnRegisterOptions({ deviceLabel: label });
      const attestation = await createPasskeyCredential(opts.options);
      await api.webauthnRegisterVerify({
        challengeId: opts.challengeId,
        credentialId: attestation.credentialId,
        clientDataJSON: attestation.clientDataJSON,
        attestationObject: attestation.attestationObject,
        transports: attestation.transports,
        deviceLabel: label,
      });
      setDeviceLabel('');
      setNotice(`Registered new passkey "${label}".`);
      await loadCredentials();
    } catch (err) {
      setError(formatWebAuthnError(err));
    } finally {
      setRegistering(false);
    }
  }

  async function handleSaveRename(id: string) {
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    setError('');
    setNotice('');
    setBusyId(id);
    try {
      await api.renameMyPasskey(id, trimmed);
      setRenamingId(null);
      setRenameDraft('');
      setNotice(`Passkey renamed to "${trimmed}".`);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename passkey.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevoke(cred: WebAuthnCredentialMetadata) {
    setError('');
    setNotice('');
    setBusyId(cred.id);
    try {
      // Step-up passkey verification before revoking a credential
      const reauthOpts = await api.webauthnReauthOptions();
      const assertion = await getPasskeyAssertion(reauthOpts.options);
      const verified = await api.webauthnReauthVerify({
        challengeId: reauthOpts.challengeId,
        ...assertion,
      });
      await api.revokeMyPasskey(cred.id, {
        reauthProof: verified.reauthProof,
        reason: 'Self-revoked via portal Security & Passkeys dialog',
      });
      setNotice(`Revoked passkey "${cred.deviceLabel}".`);
      await loadCredentials();
    } catch (err) {
      setError(formatWebAuthnError(err));
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = credentials.filter((c) => !c.revokedAt).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passkey-mgmt-modal-title"
    >
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-700" />
            <div>
              <h3
                id="passkey-mgmt-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Security &amp; Passkeys
              </h3>
              <p className="text-[11px] text-slate-500">
                {user.email} · Register backup devices so you never lose portal access
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close passkey management modal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!supported && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900"
          >
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              WebAuthn passkeys are not available in this browser context. Open the portal in a modern HTTPS browser to register or manage passkeys.
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
          >
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        {/* Register additional passkey form */}
        <form onSubmit={handleAddPasskey} className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="new-passkey-label"
              className="text-xs font-semibold text-slate-800"
            >
              Add a New Passkey / Backup Device
            </label>
            <span className="text-[11px] font-mono text-slate-500">
              {activeCount} active
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="new-passkey-label"
              type="text"
              maxLength={80}
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
              placeholder="e.g. Office Laptop, YubiKey Backup, Phone Passkey"
              className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              disabled={registering || !supported}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{registering ? 'Waiting for Passkey...' : 'Register Passkey'}</span>
            </button>
          </div>
        </form>

        {/* Registered passkeys list */}
        <div className="mt-5 space-y-2.5">
          <h4 className="text-xs font-semibold text-slate-700">Registered Passkeys</h4>

          {loading ? (
            <div className="p-4 rounded-lg border border-slate-200 text-xs text-slate-500">
              Loading registered devices...
            </div>
          ) : credentials.length === 0 ? (
            <div className="p-4 rounded-lg border border-slate-200 text-xs text-slate-500">
              No passkeys registered yet. Register a passkey above to enable passwordless sign-in.
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
              {credentials.map((cred) => {
                const isRevoked = Boolean(cred.revokedAt);
                const isRenaming = renamingId === cred.id;
                const isBusy = busyId === cred.id;
                return (
                  <li
                    key={cred.id}
                    className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isRevoked ? 'bg-slate-50/80 opacity-75' : 'bg-white'
                    }`}
                  >
                    <div className="min-w-0 flex items-start gap-2.5">
                      <Fingerprint
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          isRevoked ? 'text-slate-400' : 'text-blue-700'
                        }`}
                      />
                      <div className="min-w-0">
                        {isRenaming ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              maxLength={80}
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              aria-label="New passkey device label"
                              className="px-2 py-1 text-xs border border-slate-300 rounded-md text-slate-900"
                            />
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleSaveRename(cred.id)}
                              aria-label="Save passkey name"
                              className="p-1 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(null);
                                setRenameDraft('');
                              }}
                              aria-label="Cancel rename"
                              className="p-1 text-slate-500 hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900 truncate">
                              {cred.deviceLabel}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">
                              {cred.coseAlgorithm === -7 ? 'ES256' : 'RS256'}
                            </span>
                            {cred.backupState && (
                              <span className="text-[10px] text-blue-700 font-medium">
                                Synced
                              </span>
                            )}
                            {isRevoked && (
                              <span className="text-[10px] text-red-700 font-medium">
                                Revoked
                              </span>
                            )}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Added {new Date(cred.createdAt).toLocaleDateString()}
                          {' · '}
                          {cred.lastUsedAt
                            ? `Last used ${new Date(cred.lastUsedAt).toLocaleString()}`
                            : 'Never used yet'}
                        </div>
                      </div>
                    </div>

                    {!isRevoked && !isRenaming && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setRenamingId(cred.id);
                            setRenameDraft(cred.deviceLabel);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Rename</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRevoke(cred)}
                          title={
                            activeCount <= 1
                              ? 'Warning: revoking your last active passkey requires an administrator recovery link to sign in again.'
                              : 'Requires passkey confirmation'
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-md cursor-pointer"
                        >
                          <Ban className="w-3 h-3" />
                          <span>{isBusy ? 'Verifying...' : 'Revoke'}</span>
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
          Revoking a passkey requires confirming with an active passkey first. Keep at least two registered passkeys (for example, your laptop and mobile device). If you lose all devices, contact an IGS Administrator for a single-use recovery link.
        </p>

        <div className="mt-4 pt-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
