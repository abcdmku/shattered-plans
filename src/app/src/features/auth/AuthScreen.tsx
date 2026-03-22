interface AuthScreenProps {
  busy?: boolean;
  notice?: string;
  onSignIn: (displayName: string) => void;
}

export function AuthScreen({ busy, notice, onSignIn }: AuthScreenProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 lg:px-8">
      <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1.1fr)_420px]">
        <section className="panel flex min-h-[560px] flex-col justify-between p-8 lg:p-10">
          <div className="space-y-6">
            <div className="label">Shattered Plans</div>
            <div className="max-w-2xl space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-white lg:text-5xl">
                Command sits in the board, not the chrome.
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-300">
                Lobby, room, and turn flow now run through the Java backend with a compact web shell in front.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {['Lobby', 'Rooms', 'Turns'].map(item => (
              <div key={item} className="panel-soft min-h-36 px-5 py-5">
                <div className="label">{item}</div>
                <div className="mt-4 h-24 rounded-[22px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(111,245,216,0.12),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]" />
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-6 lg:p-8">
          <div className="space-y-2">
            <div className="label">Sign in</div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">Enter command</h2>
          </div>

          <form
            className="mt-8 space-y-4"
            onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const displayName = String(data.get('displayName') ?? '').trim();
              if (displayName) {
                onSignIn(displayName);
              }
            }}
          >
            <label className="block space-y-2">
              <span className="label">Display name</span>
              <input autoComplete="nickname" className="input" name="displayName" placeholder="Commander" />
            </label>

            <button className="button button-primary w-full" type="submit" disabled={busy}>
              {busy ? 'Connecting' : 'Continue'}
            </button>
          </form>

          {notice ? (
            <div className="mt-6 rounded-[22px] border border-amber-400/18 bg-amber-400/8 px-4 py-3 text-sm leading-6 text-amber-100">
              {notice}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
