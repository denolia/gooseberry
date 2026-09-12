type PremiumRequestEmail = {
  name: string | null;
  email: string | null;
  message: string | null;
  adminUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendPremiumRequestEmail(
  request: PremiumRequestEmail,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.PREMIUM_REQUEST_EMAIL_TO;
  const from = process.env.PREMIUM_REQUEST_EMAIL_FROM;

  if (!apiKey || !to || !from) {
    console.warn(
      "Premium request saved without email notification: email environment variables are incomplete.",
    );
    return false;
  }

  const requester = request.name || request.email || "A Learn.words user";
  const message = request.message
    ? `<p><strong>Message</strong></p><p>${escapeHtml(request.message).replaceAll("\n", "<br>")}</p>`
    : "<p>No message was included.</p>";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Premium request from ${requester}`,
        html: `<h1>New Learn.words premium request</h1>
          <p><strong>Name:</strong> ${escapeHtml(request.name || "—")}</p>
          <p><strong>Email:</strong> ${escapeHtml(request.email || "—")}</p>
          ${message}
          <p><a href="${escapeHtml(request.adminUrl)}">Review the request in Learn.words</a></p>`,
      }),
    });

    if (!response.ok) {
      console.error(
        "Premium request email failed:",
        response.status,
        await response.text(),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("Premium request email failed:", error);
    return false;
  }
}
