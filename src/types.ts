export type AdminRole = 'Owner' | 'Admin' | 'Viewer';
export type RoleName = 'Translator' | 'Editor' | 'Solo';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  discordUserId?: string | null;
}

export interface Period {
  id: string;
  guild_id: string;
  period_key: string;
  year: number;
  month: number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED' | 'REOPENED';
  opened_at: string;
  closed_at?: string | null;
  closed_by?: string | null;
  reopened_at?: string | null;
  reopened_by?: string | null;
  reopen_reason?: string | null;
}

export interface BotState {
  status: 'CONNECTED' | 'CONNECTING' | 'STANDBY_NO_TOKEN' | 'ERROR';
  botTag: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  guildCount: number;
}
