export type RoleName = 'Translator' | 'Editor' | 'Solo';
export type AdminRole = 'Owner' | 'Admin' | 'Viewer';
export type PeriodStatus = 'OPEN' | 'CLOSING' | 'CLOSED' | 'REOPENED';
export type ApprovalStatus = 'auto_approved' | 'approved' | 'pending' | 'rejected' | 'void';
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface ParsedReportResult {
  isReport: boolean;
  parseStatus:
    | 'VALID'
    | 'AMBIGUOUS_PROJECT'
    | 'PROJECT_CHANNEL_CONFLICT'
    | 'UNKNOWN_ROLE'
    | 'INVALID_CHAPTER'
    | 'UNKNOWN_STATUS'
    | 'NOT_A_REPORT';
  parseNotes: string[];
  projectId: string | null;
  projectTitleMatched: string | null;
  role: RoleName | null;
  roleTokenMatched: string | null;
  workStatus: string | null;
  chapters: number[];
  mentions: string[];
  cleanedContent: string;
}

export interface IncomingDiscordMessage {
  discordMessageId: string;
  discordGuildId: string;
  discordChannelId: string;
  discordAuthorId: string;
  authorUsername: string;
  authorDisplayName: string;
  content: string;
  mentions?: string[];
  messageTimestamp?: string;
  messageUrl?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  discordUserId?: string | null;
}
