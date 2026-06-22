import React, { useState, useEffect } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';

type ThemeMode = 'light' | 'dark';

interface LoginProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  passwordRecovery?: boolean;
  onPasswordRecoveryComplete?: () => void;
}

type MessageTone = 'info' | 'success' | 'error';

const getAuthErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
};

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

const Login: React.FC<LoginProps> = ({
  theme,
  onThemeChange,
  passwordRecovery = false,
  onPasswordRecoveryComplete
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<MessageTone>('info');
  const [recoveryComplete, setRecoveryComplete] = useState(false);

  const [displayText, setDisplayText] = useState('');
  const [showFields, setShowFields] = useState(false);
  const fullText = passwordRecovery
    ? 'Defina sua nova senha.'
    : (isSignUp ? 'Crie sua conta.' : 'Faça seu Login.');

  useEffect(() => {
    setDisplayText('');
    let i = 0;
    let revealTimeout: ReturnType<typeof setTimeout> | undefined;
    const typingInterval = setInterval(() => {
      if (i < fullText.length) {
        setDisplayText(fullText.slice(0, i + 1));
        i++;
      } else {
        clearInterval(typingInterval);
        revealTimeout = setTimeout(() => setShowFields(true), 200);
      }
    }, 80);

    return () => {
      clearInterval(typingInterval);
      if (revealTimeout) clearTimeout(revealTimeout);
    };
  }, [fullText]);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setMessageTone('info');
    const normalizedEmail = email.trim();

    if (!isSupabaseConfigured) {
      setMessage('Login indisponivel: configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env e reinicie o servidor.');
      setMessageTone('error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setMessage('Informe um e-mail válido.');
      setMessageTone('error');
      return;
    }
    if (isSignUp && password.length < 8) {
      setMessage('A senha deve ter pelo menos 8 caracteres.');
      setMessageTone('error');
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email: normalizedEmail, password });
        if (error) throw error;
        setMessage('Conta criada. Verifique seu email para confirmar o cadastro, se a confirmacao estiver ativa no Supabase.');
        setMessageTone('success');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw error;
      }
    } catch (error: unknown) {
      setMessage(getAuthErrorMessage(error, 'Erro na autenticação.'));
      setMessageTone('error');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetRequest = async () => {
    setMessage('');

    if (!isSupabaseConfigured) {
      setMessage('Recuperação indisponível: configure o Supabase antes de solicitar uma nova senha.');
      setMessageTone('error');
      return;
    }

    const normalizedEmail = email.trim();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!isValidEmail) {
      setMessage('Informe um e-mail válido no campo Identificação antes de recuperar a senha.');
      setMessageTone('error');
      return;
    }

    setResetLoading(true);
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (error) throw error;

      setMessage('Se o e-mail estiver cadastrado, você receberá um link para definir uma nova senha. Verifique também a caixa de spam.');
      setMessageTone('success');
    } catch (error: unknown) {
      setMessage(getAuthErrorMessage(error, 'Não foi possível enviar o link de recuperação.'));
      setMessageTone('error');
    } finally {
      setResetLoading(false);
    }
  };

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');

    if (password.length < 8) {
      setMessage('A nova senha deve ter pelo menos 8 caracteres.');
      setMessageTone('error');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('A confirmação não corresponde à nova senha.');
      setMessageTone('error');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setPassword('');
      setConfirmPassword('');
      setRecoveryComplete(true);
      setMessage('Senha atualizada com sucesso. Agora você pode voltar ao login.');
      setMessageTone('success');
    } catch (error: unknown) {
      setMessage(getAuthErrorMessage(error, 'Não foi possível atualizar a senha. Solicite um novo link e tente novamente.'));
      setMessageTone('error');
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToLogin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.history.replaceState({}, document.title, window.location.pathname);
      onPasswordRecoveryComplete?.();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível voltar ao login.');
      setMessageTone('error');
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
  const messageClass = {
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-cyan-900/30 dark:bg-cyan-900/10 dark:text-cyan-300',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    error: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
  }[messageTone];

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
            <div role="status" aria-live="polite" className={`mb-6 rounded-xl border p-4 text-sm font-medium leading-relaxed ${messageClass}`}>
              {message}
            </div>
          )}

          <form onSubmit={passwordRecovery ? handlePasswordUpdate : handleAuth} className="space-y-8">
            {!passwordRecovery && (
              <div className={`transition-all duration-700 ${showFields ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                <label className={`mb-3 ml-1 block text-[10px] font-black uppercase tracking-[0.2em] transition-opacity duration-1000 delay-500 ${labelClass} ${showFields ? 'opacity-100' : 'opacity-0'}`}>
                  Identificação
                </label>
                <div className={`split-expand rounded-xl bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400 p-[1px] ${showFields ? 'scale-x-100' : 'scale-x-0 opacity-0'}`}>
                  <div className={`h-full w-full rounded-xl ${inputShellClass}`}>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      className={`w-full rounded-xl bg-transparent px-5 py-4 font-medium outline-none ${inputClass}`}
                      placeholder="E-mail corporativo"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {!recoveryComplete && (
              <div className={`transition-all delay-150 duration-700 ${showFields ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                <label className={`mb-3 ml-1 block text-[10px] font-black uppercase tracking-[0.2em] transition-opacity duration-1000 delay-700 ${labelClass} ${showFields ? 'opacity-100' : 'opacity-0'}`}>
                  {passwordRecovery ? 'Nova senha' : 'Chave de acesso'}
                </label>
                <div className={`split-expand rounded-xl bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400 p-[1px] ${showFields ? 'scale-x-100' : 'scale-x-0 opacity-0'}`}>
                  <div className={`h-full w-full rounded-xl ${inputShellClass}`}>
                    <input
                      type="password"
                      required
                      minLength={passwordRecovery || isSignUp ? 8 : undefined}
                      autoComplete={passwordRecovery || isSignUp ? 'new-password' : 'current-password'}
                      className={`w-full rounded-xl bg-transparent px-5 py-4 font-medium outline-none ${inputClass}`}
                      placeholder={passwordRecovery ? 'Mínimo de 8 caracteres' : 'Senha'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                </div>

                {!passwordRecovery && !isSignUp && (
                  <div className={`mt-4 flex justify-end transition-all delay-1000 duration-1000 ${showFields ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'}`}>
                    <button
                      type="button"
                      onClick={handlePasswordResetRequest}
                      disabled={resetLoading || loading}
                      className="text-xs font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-cyan-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-500 dark:hover:text-cyan-400"
                    >
                      {resetLoading ? 'Enviando link...' : 'Recuperar senha'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {passwordRecovery && !recoveryComplete && (
              <div className={`transition-all delay-300 duration-700 ${showFields ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                <label className={`mb-3 ml-1 block text-[10px] font-black uppercase tracking-[0.2em] ${labelClass}`}>
                  Confirmar nova senha
                </label>
                <div className="rounded-xl bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400 p-[1px]">
                  <div className={`h-full w-full rounded-xl ${inputShellClass}`}>
                    <input
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className={`w-full rounded-xl bg-transparent px-5 py-4 font-medium outline-none ${inputClass}`}
                      placeholder="Repita a nova senha"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className={`pt-4 transition-all delay-[1200ms] duration-1000 ${showFields ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
              {recoveryComplete ? (
                <button
                  type="button"
                  onClick={handleReturnToLogin}
                  disabled={loading}
                  className="w-full rounded-2xl bg-gradient-to-r from-emerald-700 to-teal-500 py-5 text-sm font-black uppercase tracking-[0.24em] text-white shadow-sm transition hover:from-emerald-600 hover:to-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Voltar ao login
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading || resetLoading}
                  className="w-full rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 py-5 text-sm font-black uppercase tracking-[0.3em] text-white shadow-[0_10px_40px_rgba(6,182,212,0.25)] transition-all duration-500 hover:from-blue-600 hover:to-cyan-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading
                    ? 'Processando...'
                    : (passwordRecovery ? 'Salvar nova senha' : (isSignUp ? 'Confirmar registro' : 'Acessar workspace'))}
                </button>
              )}
            </div>
          </form>

          <div className={`mt-12 text-center transition-all delay-[1400ms] duration-1000 ${showFields ? 'opacity-100' : 'opacity-0'}`}>
            {passwordRecovery ? (
              !recoveryComplete && (
                <button
                  type="button"
                  onClick={handleReturnToLogin}
                  disabled={loading}
                  className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-950 disabled:opacity-50 dark:text-gray-600 dark:hover:text-white"
                >
                  Cancelar e voltar ao login
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setMessage(''); setShowFields(false); }}
                className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-950 dark:text-gray-600 dark:hover:text-white"
              >
                {isSignUp ? 'Voltar ao login' : 'Não possuo uma credencial'}
              </button>
            )}
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
