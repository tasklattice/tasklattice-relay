import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { PlatformEmailRuntimeSettings } from "../platform/platform-settings-service";
import { SmtpInvitationMailer } from "./smtp-invitation-mailer";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => error ? reject(error) : resolve()),
        ),
    ),
  );
});

describe("SmtpInvitationMailer", () => {
  it("delivers an invitation through a real SMTP conversation", async () => {
    const messages: string[] = [];
    const server = createSmtpServer(messages);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("SMTP test server did not bind a TCP port.");

    const smtp: PlatformEmailRuntimeSettings = {
      configurationError: null,
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      username: "",
      password: "",
      passwordConfigured: false,
      fromAddress: "invites@tali.test",
      fromName: "TaskLattice Relay",
      replyTo: "operator@tali.test",
    };
    const mailer = new SmtpInvitationMailer(
      async () => smtp,
    );

    await mailer.verify();
    await mailer.sendProjectInvitation({
      loginUrl: "https://tali.example.com",
      email: "new-user@example.com",
      inviterEmail: "admin@example.com",
      inviterName: "Platform Administrator",
      projectName: "AI Platform",
      role: "user",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("To: new-user@example.com");
    expect(messages[0]).toContain("Subject: You are invited to AI Platform on TaskLattice Relay");
    expect(messages[0]).toContain("https://tali.example.com");
  });

  it("rejects delivery when SMTP is disabled", async () => {
    const mailer = new SmtpInvitationMailer(
      async () => ({
        configurationError: null,
        enabled: false,
        fromAddress: "",
        fromName: "TaskLattice Relay",
        host: "",
        password: "",
        passwordConfigured: false,
        port: 587,
        replyTo: "",
        secure: false,
        username: "",
      }),
    );
    await expect(mailer.assertConfigured()).rejects.toThrow(/not enabled/i);
  });
});

function createSmtpServer(messages: string[]): Server {
  return createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost TaskLattice Relay test SMTP\r\n");
    let buffer = "";
    let receivingData = false;

    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.length) {
        if (receivingData) {
          const terminator = buffer.indexOf("\r\n.\r\n");
          if (terminator < 0) return;
          messages.push(buffer.slice(0, terminator));
          buffer = buffer.slice(terminator + 5);
          receivingData = false;
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd < 0) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const command = line.split(" ", 1)[0]?.toUpperCase();
        if (command === "EHLO" || command === "HELO") {
          socket.write("250-localhost\r\n250 SIZE 1048576\r\n");
        } else if (command === "MAIL" || command === "RCPT" || command === "RSET") {
          socket.write("250 2.1.0 accepted\r\n");
        } else if (command === "DATA") {
          receivingData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command === "QUIT") {
          socket.end("221 2.0.0 bye\r\n");
        } else {
          socket.write("250 2.0.0 ok\r\n");
        }
      }
    });
  });
}
