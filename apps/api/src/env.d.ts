declare namespace NodeJS {
  interface ProcessEnv {
    API_PORT?: string;
    DATABASE_URL?: string;
    TELEGRAM_BOT_TOKEN?: string;
    R2_BUCKET?: string;
  }
}
