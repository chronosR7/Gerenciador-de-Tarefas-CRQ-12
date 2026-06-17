import React, { useState, useEffect } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';

type ThemeMode = 'light' | 'dark';

interface LoginProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const ThemeIcon: React.FC<{ theme: ThemeMode }> = ({ theme }) => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {theme === 'dark' ? (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.9 4.9 1.4 1.4" />
        <path d="m17.7 17.7 1.4 1.4" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m4.9 19.1 1.4-1.4" />
        <path d="m17.7 6.3 1.4-1.4" />
      </>
    ) : (
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    )}
  </svg>
);

const Login: React.FC<LoginProps> = ({ theme, onThemeChange }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');

  const [displayText, setDisplayText] = useState('');
  const [showFields, setShowFields] = useState(false);
  const fullText = isSignUp ? 'Crie sua conta.' : 'Faça seu Login.';

  useEffect(() => {
    setDisplayText('');
    let i = 0;
    const typingInterval = setInterval(() => {
      if (i < fullText.length) {
        setDisplayText(fullText.slice(0, i + 1));
        i++;
      } else {
        clearInterval(typingInterval);
        setTimeout(() => setShowFields(true), 200);
      }
    }, 80);

    return () => clearInterval(typingInterval);
  }, [fullText]);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');

    if (!isSupabaseConfigured) {
      setMessage('Login indisponivel: configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env e reinicie o servidor.');
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Conta criada. Verifique seu email para confirmar o cadastro, se a confirmacao estiver ativa no Supabase.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      setMessage(error.message || 'Erro na autenticacao.');
    } finally {
      setLoading(false);
    }
  };

  const inputShellClass = theme === 'dark'
    ? 'bg-[#0a0a0a] shadow-2xl shadow-black/50'
    : 'bg-white shadow-xl shadow-sky-900/10';
  const inputClass = theme === 'dark'
    ? 'text-white placeholder-gray-700'
    : 'text-zinc-900 placeholder-zinc-400';
  const labelClass = theme === 'dark'
    ? 'text-gray-500'
    : 'text-zinc-500';

  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-zinc-50 font-sans text-zinc-950 transition-colors dark:bg-[#050505] dark:text-white">
      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        .cursor-blink { animation: blink 1s step-end infinite; }
        .split-expand { transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s ease; }
      `}</style>

      <button
        type="button"
        onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
        className="fixed right-5 top-5 z-30 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white/90 px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-700 shadow-sm backdrop-blur transition hover:bg-white dark:border-white/10 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-900"
        aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
        title={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
      >
        <ThemeIcon theme={theme} />
        {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
      </button>

      <div className="relative z-10 flex w-full flex-col justify-center px-8 sm:px-16 lg:w-[45%] lg:px-24">
        <div className="pointer-events-none absolute left-0 top-1/4 h-[500px] w-[500px] rounded-full bg-sky-500/10 blur-[120px] dark:bg-blue-900/20" />

        <div className="mx-auto w-full max-w-md">
          <h1 className="mb-12 min-h-[60px] text-4xl font-extrabold tracking-tight sm:text-5xl">
            {displayText}
            <span className="cursor-blink text-cyan-400">|</span>
          </h1>

          {!isSupabaseConfigured && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
              Supabase nao configurado. Para entrar, preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no arquivo `.env` e reinicie o servidor.
            </div>
          )}

          {message && (
            <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-800 dark:border-cyan-900/30 dark:bg-cyan-900/10 dark:text-cyan-300">
              {message}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-8">
            <div className={`transition-all duration-700 ${showFields ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
              <label className={`mb-3 ml-1 block text-[10px] font-black uppercase tracking-[0.2em] transition-opacity duration-1000 delay-500 ${labelClass} ${showFields ? 'opacity-100' : 'opacity-0'}`}>
                Identificacao
              </label>
              <div className={`split-expand rounded-xl bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400 p-[1px] ${showFields ? 'scale-x-100' : 'scale-x-0 opacity-0'}`}>
                <div className={`h-full w-full rounded-xl ${inputShellClass}`}>
                  <input
                    type="email"
                    required
                    className={`w-full rounded-xl bg-transparent px-5 py-4 font-medium outline-none ${inputClass}`}
                    placeholder="E-mail corporativo"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className={`transition-all delay-150 duration-700 ${showFields ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
              <label className={`mb-3 ml-1 block text-[10px] font-black uppercase tracking-[0.2em] transition-opacity duration-1000 delay-700 ${labelClass} ${showFields ? 'opacity-100' : 'opacity-0'}`}>
                Chave de acesso
              </label>
              <div className={`split-expand rounded-xl bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400 p-[1px] ${showFields ? 'scale-x-100' : 'scale-x-0 opacity-0'}`}>
                <div className={`h-full w-full rounded-xl ${inputShellClass}`}>
                  <input
                    type="password"
                    required
                    className={`w-full rounded-xl bg-transparent px-5 py-4 font-medium outline-none ${inputClass}`}
                    placeholder="Senha"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </div>

              <div className={`mt-4 flex justify-end transition-all delay-1000 duration-1000 ${showFields ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'}`}>
                <button type="button" className="text-xs font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-cyan-500 dark:text-gray-500 dark:hover:text-cyan-400">
                  Recuperar senha
                </button>
              </div>
            </div>

            <div className={`pt-4 transition-all delay-[1200ms] duration-1000 ${showFields ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 py-5 text-sm font-black uppercase tracking-[0.3em] text-white shadow-[0_10px_40px_rgba(6,182,212,0.25)] transition-all duration-500 hover:from-blue-600 hover:to-cyan-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Processando...' : (isSignUp ? 'Confirmar registro' : 'Acessar workspace')}
              </button>
            </div>
          </form>

          <div className={`mt-12 text-center transition-all delay-[1400ms] duration-1000 ${showFields ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={() => { setIsSignUp(!isSignUp); setMessage(''); setShowFields(false); }}
              className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-950 dark:text-gray-600 dark:hover:text-white"
            >
              {isSignUp ? 'Voltar ao login' : 'Nao possuo uma credencial'}
            </button>
          </div>
        </div>

        <div className={`absolute bottom-8 left-0 w-full text-center text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-400 transition-opacity delay-[1600ms] duration-1000 dark:text-gray-700 ${showFields ? 'opacity-100' : 'opacity-0'}`}>
          2026 © Desenvolvido por chronosR7
        </div>
      </div>

      <div className="relative hidden overflow-hidden lg:block lg:w-[55%]">
        <div
          className={`absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-[10s] ease-out ${showFields ? 'scale-110' : 'scale-100'}`}
          style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1464802686167-b939a6910659?q=80&w=2050&auto=format&fit=crop")' }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-50 via-zinc-50/50 to-transparent dark:from-[#050505] dark:via-[#050505]/40" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-zinc-50 dark:from-[#050505]/20 dark:to-[#050505]" />
        <div className="absolute inset-0 bg-sky-900/10 mix-blend-multiply dark:bg-transparent" />
      </div>
    </div>
  );
};

export default Login;
