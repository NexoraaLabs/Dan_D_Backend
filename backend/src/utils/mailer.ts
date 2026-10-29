// Placeholder until an email provider is chosen (Resend, SendGrid, SES, ...):
// messages are written to the server log so flows can be tested via the
// Railway log viewer. Swap the body of sendEmail for the provider's SDK call.
export async function sendEmail(input: { to: string; subject: string; text: string }) {
  console.log(`[mailer] to=${input.to} subject="${input.subject}"\n${input.text}`);
}
