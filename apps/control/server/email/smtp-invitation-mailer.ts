import {
  PlatformSettingsService,
  type PlatformEmailRuntimeSettings,
} from "../platform/platform-settings-service";
import type { ProjectRole } from "../projects/project-service";
import { createSmtpTransport } from "./smtp-transport";

export interface ProjectInvitationEmail {
  email: string;
  loginUrl: string;
  inviterEmail: string;
  inviterName: string;
  projectName: string;
  role: ProjectRole;
}

export interface InvitationMailer {
  assertConfigured(): Promise<void>;
  sendProjectInvitation(invitation: ProjectInvitationEmail): Promise<void>;
}

export class SmtpInvitationMailer implements InvitationMailer {
  constructor(
    private readonly loadSmtp: () => Promise<PlatformEmailRuntimeSettings> =
      () => new PlatformSettingsService().emailRuntimeSettings(),
  ) {}

  async assertConfigured(): Promise<void> {
    this.assertRuntimeConfigured(await this.loadSmtp());
  }

  private assertRuntimeConfigured(smtp: PlatformEmailRuntimeSettings): void {
    if (!smtp.enabled) {
      throw new Error(
        "SMTP invitation delivery is not enabled in Platform Setting.",
      );
    }

  }

  async verify(): Promise<void> {
    const smtp = await this.loadSmtp();
    this.assertRuntimeConfigured(smtp);
    await createSmtpTransport(smtp).verify();
  }

  async sendProjectInvitation(
    invitation: ProjectInvitationEmail,
  ): Promise<void> {
    const smtp = await this.loadSmtp();
    this.assertRuntimeConfigured(smtp);
    const loginUrl = invitation.loginUrl;
    if (!loginUrl) throw new Error("Invitation delivery requires the requesting origin.");
    const roleLabel = ({
      admin: "Project Administrator",
      auditor: "Auditor",
      developer: "Agent Developer",
      user: "User",
      reviewer: "Reviewer",
    } as const)[invitation.role];
    const subject = `You are invited to ${invitation.projectName} on TaskLattice Relay`;
    const text = [
      `${invitation.inviterName} (${invitation.inviterEmail}) invited you to join ${invitation.projectName} as ${roleLabel}.`,
      "",
      `Open TaskLattice Relay and sign in with ${invitation.email}:`,
      loginUrl,
      "",
      "The invitation is accepted automatically after TaskLattice Relay verifies the same email address through your configured identity provider.",
    ].join("\n");
    const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f7f7;color:#171717;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:40px 24px">
      <div style="background:#ffffff;border:1px solid #e5e5e5;padding:32px">
        <p style="margin:0 0 12px;color:#6b6b6b;font-size:12px;letter-spacing:.12em;text-transform:uppercase">TaskLattice Relay invitation</p>
        <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25">Join ${escapeHtml(invitation.projectName)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6">${escapeHtml(invitation.inviterName)} invited you to collaborate as <strong>${roleLabel}</strong>.</p>
        <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#4c36ff;color:#ffffff;text-decoration:none;padding:12px 18px;font-weight:600">Open TaskLattice Relay</a>
        <p style="margin:24px 0 0;color:#6b6b6b;font-size:13px;line-height:1.6">Sign in with <strong>${escapeHtml(invitation.email)}</strong>. Your invitation is accepted after the configured identity provider verifies that email address.</p>
      </div>
    </div>
  </body>
</html>`;

    try {
      await createSmtpTransport(smtp).sendMail({
        from: {
          address: smtp.fromAddress,
          name: smtp.fromName,
        },
        ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
        to: invitation.email,
        subject,
        text,
        html,
      });
    } catch (error) {
      throw new Error(
        `SMTP delivery failed: ${
          error instanceof Error ? error.message : "unknown SMTP error"
        }`,
      );
    }
  }

}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]!,
  );
}
