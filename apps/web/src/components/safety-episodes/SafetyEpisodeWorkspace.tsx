import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LoginResponse } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui';
import { SafetyEpisodeInbox as Inbox } from './SafetyEpisodeInbox';
type Session = Pick<LoginResponse, 'accessToken' | 'user'>;
interface Props {
  apiUrl: string;
  session: Session | null;
  children: ReactNode;
  onSignOut?: () => void;
}
/** Adds a recipient view without changing existing incident/task/review routing. */
export function SafetyEpisodeWorkspace({ session, children, ...props }: Props) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const roles = JSON.stringify(session?.user.roleAssignments ?? []);
  const [credential, setCredential] = useState(() => ({
    token: session?.accessToken,
    user: session?.user.id,
    roles,
    nonce: crypto.randomUUID(),
  }));
  if (
    credential.token !== session?.accessToken ||
    credential.user !== session?.user.id ||
    credential.roles !== roles
  ) {
    setCredential({
      token: session?.accessToken,
      user: session?.user.id,
      roles,
      nonce: crypto.randomUUID(),
    });
  }
  const sites =
    session?.user.roleAssignments.flatMap((r) =>
      r.role === 'SAFETY_OFFICER' && r.siteId ? [r.siteId] : [],
    ) ?? [];
  const grouped = params.get('tab') === 'episodes';
  const target = new URLSearchParams(params);
  target.delete('alertId');
  target.delete('incidentId');
  target.delete('actionId');
  if (grouped) target.delete('tab');
  else target.set('tab', 'episodes');
  const allowed =
    !!session?.accessToken &&
    session.user.isActive &&
    !session.user.mustChangePassword &&
    sites.length > 0;
  if (grouped && !allowed)
    return (
      <Card role="alert">
        <p>{t('episodes.denied')}</p>
        <Link className="underline" to={`/incidents?${target}`}>
          {t('episodes.back')}
        </Link>
      </Card>
    );
  return (
    <div className="space-y-4">
      {allowed && (
        <nav
          aria-label={t('episodes.views')}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-slate-600">
            {grouped ? t('episodes.intro') : t('episodes.entryHint')}
          </p>
          <Link
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold focus-visible:outline-2"
            to={`/incidents?${target}`}
          >
            {t(grouped ? 'episodes.back' : 'episodes.title')}
          </Link>
        </nav>
      )}
      {grouped && session ? (
        <Inbox
          key={credential.nonce}
          {...props}
          session={session}
          scope={credential.nonce}
          sites={sites}
        />
      ) : (
        children
      )}
    </div>
  );
}
