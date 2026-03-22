interface AuthScreenProps {
  busy?: boolean;
  notice?: string;
  onSignIn: (displayName: string) => void;
}

export function AuthScreen({ busy, notice, onSignIn }: AuthScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-deep px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <header className="space-y-2">
          <h1 className="font-display text-4xl font-bold uppercase tracking-[0.2em] text-white">
            Shattered Plans
          </h1>
          <p className="text-sm text-muted">Stellar conquest</p>
        </header>

        <div className="panel space-y-6 p-8">
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const displayName = String(data.get('displayName') ?? '').trim();
              if (displayName) {
                onSignIn(displayName);
              }
            }}
          >
            <label className="block space-y-2 text-left">
              <span className="label">Display name</span>
              <input
                autoComplete="nickname"
                className="input"
                name="displayName"
                placeholder="Commander"
              />
            </label>

            <button className="btn btn-primary w-full" type="submit" disabled={busy}>
              {busy ? 'Connecting…' : 'Enter'}
            </button>
          </form>

          {notice ? (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-left text-sm leading-6 text-amber-100">
              {notice}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
