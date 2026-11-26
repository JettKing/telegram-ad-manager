async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const expectedUsername = process.env.EXPECTED_TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim();
  const expectedId = process.env.EXPECTED_TELEGRAM_BOT_ID?.trim();

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not configured for this diagnostic.");
    process.exit(1);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
    let payload: { ok?: boolean; result?: { id?: number; username?: string; first_name?: string } };
    try {
      payload = await response.json() as typeof payload;
    } catch {
      console.error(`Telegram getMe returned a non-JSON response (HTTP ${response.status}).`);
      process.exit(1);
    }

    if (!response.ok || payload.ok !== true || !payload.result?.id) {
      console.error(`Telegram getMe rejected the configured token (HTTP ${response.status}).`);
      process.exit(1);
    }

    const botId = String(payload.result.id);
    const username = payload.result.username ?? "";
    console.log(`Telegram token identity: @${username || "(no username)"} (id=${botId})`);

    if (expectedUsername && username.toLowerCase() !== expectedUsername.toLowerCase()) {
      console.error(`Bot username mismatch: expected @${expectedUsername}, received @${username || "(no username)"}.`);
      process.exit(1);
    }
    if (expectedId && botId !== expectedId) {
      console.error(`Bot ID mismatch: expected ${expectedId}, received ${botId}.`);
      process.exit(1);
    }
    console.log("Telegram Bot identity matches the expected production Bot.");
  } catch (error) {
    console.error(error instanceof Error && error.name === "AbortError" ? "Telegram getMe timed out." : "Telegram getMe request failed.");
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

void main();
