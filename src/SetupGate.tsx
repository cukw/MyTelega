import type { FormEvent } from "react";

export type SetupFormState = {
  apiId: string;
  apiHash: string;
  phoneNumber: string;
  socks5Host: string;
  socks5Port: string;
  socks5Username: string;
  socks5Password: string;
};

type Props = {
  loading: boolean;
  saving: boolean;
  error: string;
  form: SetupFormState;
  onChange: (field: keyof SetupFormState, value: string) => void;
  onSubmit: (event: FormEvent) => void;
};

export default function SetupGate({
  loading,
  saving,
  error,
  form,
  onChange,
  onSubmit,
}: Props) {
  return (
    <main className="setup-window">
      <section className="setup-card">
        <header className="setup-header">
          <span className="setup-badge">First Launch Setup</span>
          <h1>Подключение Telegram</h1>
          <p>
            Этот экран показывается только при первом запуске. После сохранения
            данные и сессия будут подхватываться автоматически.
          </p>
        </header>

        <section className="setup-tutorial">
          <h2>Короткий туториал (2 минуты)</h2>
          <ol>
            <li>
              Откройте <code>https://my.telegram.org</code> и войдите по номеру
              телефона.
            </li>
            <li>
              Перейдите в <code>API development tools</code> и создайте приложение.
            </li>
            <li>
              Скопируйте <code>api_id</code> и <code>api_hash</code> в поля ниже.
            </li>
            <li>
              Укажите ваш SOCKS5 proxy: <code>ip</code>, <code>port</code>,
              <code>login</code>, <code>password</code>.
            </li>
          </ol>
        </section>

        <form className="setup-form" onSubmit={onSubmit}>
          <label>
            API ID
            <input
              value={form.apiId}
              onChange={(event) => onChange("apiId", event.target.value)}
              placeholder="12345678"
              inputMode="numeric"
              autoComplete="off"
            />
          </label>

          <label>
            API Hash
            <input
              value={form.apiHash}
              onChange={(event) => onChange("apiHash", event.target.value)}
              placeholder="e9b...."
              autoComplete="off"
            />
          </label>

          <label>
            Phone (optional)
            <input
              value={form.phoneNumber}
              onChange={(event) => onChange("phoneNumber", event.target.value)}
              placeholder="+79990001122"
              autoComplete="off"
            />
          </label>

          <div className="setup-grid">
            <label>
              SOCKS5 Host (IP)
              <input
                value={form.socks5Host}
                onChange={(event) => onChange("socks5Host", event.target.value)}
                placeholder="203.0.113.10"
                autoComplete="off"
              />
            </label>

            <label>
              SOCKS5 Port
              <input
                value={form.socks5Port}
                onChange={(event) => onChange("socks5Port", event.target.value)}
                placeholder="1080"
                inputMode="numeric"
                autoComplete="off"
              />
            </label>

            <label>
              SOCKS5 Login
              <input
                value={form.socks5Username}
                onChange={(event) => onChange("socks5Username", event.target.value)}
                placeholder="proxy_user"
                autoComplete="off"
              />
            </label>

            <label>
              SOCKS5 Password
              <input
                value={form.socks5Password}
                onChange={(event) => onChange("socks5Password", event.target.value)}
                placeholder="proxy_pass"
                type="password"
                autoComplete="off"
              />
            </label>
          </div>

          {error ? <p className="setup-error">{error}</p> : null}

          <button type="submit" disabled={loading || saving}>
            {loading ? "Загрузка..." : saving ? "Сохраняем..." : "Сохранить и открыть мессенджер"}
          </button>
        </form>
      </section>
    </main>
  );
}
