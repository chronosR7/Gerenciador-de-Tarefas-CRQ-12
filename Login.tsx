import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');

  // Estados para as animações
  const [displayText, setDisplayText] = useState('');
  const [showFields, setShowFields] = useState(false);
  const fullText = isSignUp ? "Crie sua conta." : "Faça seu Login.";

  // Efeito Typewriter (Letra por letra)
  useEffect(() => {
    setDisplayText('');
    let i = 0;
    const typingInterval = setInterval(() => {
      if (i < fullText.length) {
        setDisplayText(fullText.slice(0, i + 1));
        i++;
      } else {
        clearInterval(typingInterval);
        // Após terminar de digitar, engatilha a expansão dos campos
        setTimeout(() => setShowFields(true), 200);
      }
    }, 80); // Velocidade da digitação

    return () => clearInterval(typingInterval);
  }, [isSignUp]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Conta criada! Verifique seu email para confirmar.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      setMessage(error.message || 'Erro na autenticação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[#050505] font-sans text-white overflow-hidden">
      
      {/* Estilos de Animação Customizados */}
      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        .cursor-blink { animation: blink 1s step-end infinite; }
        
        .split-expand {
          transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s ease;
        }
      `}</style>

      {/* Lado Esquerdo - Conteúdo */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-8 sm:px-16 lg:px-24 z-10 relative">
        
        {/* Brilho de fundo ambiente */}
        <div className="absolute top-1/4 left-0 w-[500px] h-[500px] bg-blue-900/20 rounded-full mix-blend-screen filter blur-[120px] pointer-events-none"></div>

        <div className="w-full max-w-md mx-auto">
          
          {/* Título com Typewriter */}
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-12 tracking-tighter min-h-[60px]">
            {displayText}
            <span className="text-cyan-400 cursor-blink">|</span>
          </h1>

          {message && (
            <div className="p-4 mb-6 rounded-xl text-sm font-medium border border-cyan-900/30 bg-cyan-900/10 text-cyan-300 animate-[fadeIn_0.5s_ease-out]">
              {message}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-8">
            
            {/* Campo Email com animação de "Split" (abre do centro) */}
            <div className={`transition-all duration-700 ${showFields ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <label className={`block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-3 ml-1 transition-opacity duration-1000 delay-500 ${showFields ? 'opacity-100' : 'opacity-0'}`}>
                Identificação
              </label>
              <div 
                className={`p-[1px] rounded-xl bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400 split-expand shadow-2xl shadow-black/50 ${showFields ? 'scale-x-100' : 'scale-x-0 opacity-0'}`}
              >
                <div className="bg-[#0a0a0a] rounded-xl h-full w-full">
                  <input
                    type="email"
                    required
                    className="w-full bg-transparent px-5 py-4 text-white outline-none rounded-xl placeholder-gray-700 font-medium"
                    placeholder="E-mail corporativo"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Campo Senha com animação de "Split" */}
            <div className={`transition-all duration-700 delay-150 ${showFields ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <label className={`block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-3 ml-1 transition-opacity duration-1000 delay-700 ${showFields ? 'opacity-100' : 'opacity-0'}`}>
                Chave de Acesso
              </label>
              <div 
                className={`p-[1px] rounded-xl bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400 split-expand shadow-2xl shadow-black/50 ${showFields ? 'scale-x-100' : 'scale-x-0 opacity-0'}`}
              >
                <div className="bg-[#0a0a0a] rounded-xl h-full w-full">
                  <input
                    type="password"
                    required
                    className="w-full bg-transparent px-5 py-4 text-white outline-none rounded-xl placeholder-gray-700 font-medium"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              
              <div className={`flex justify-end mt-4 transition-all duration-1000 delay-1000 ${showFields ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}`}>
                <a href="#" className="text-xs font-bold text-gray-500 hover:text-cyan-400 transition-colors uppercase tracking-widest">
                  Recuperar Senha
                </a>
              </div>
            </div>

            {/* Botão com Faded-In */}
            <div className={`pt-4 transition-all duration-1000 delay-[1200ms] ${showFields ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-5 rounded-2xl font-black text-sm uppercase tracking-[0.3em] text-white bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 hover:from-blue-600 hover:to-cyan-400 transition-all duration-500 transform active:scale-[0.98] shadow-[0_10px_40px_rgba(6,182,212,0.25)] disabled:opacity-50"
              >
                {loading ? 'Processando...' : (isSignUp ? 'Confirmar Registro' : 'Acessar Workspace')}
              </button>
            </div>

          </form>

          <div className={`text-center mt-12 transition-all duration-1000 delay-[1400ms] ${showFields ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={() => { setIsSignUp(!isSignUp); setMessage(''); setShowFields(false); }}
              className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-600 hover:text-white transition-colors"
            >
              {isSignUp ? 'Voltar ao login' : 'Não possuo uma credencial'}
            </button>
          </div>

        </div>

        {/* Copyright Faded */}
        <div className={`absolute bottom-8 left-0 w-full text-center text-[10px] text-gray-700 font-bold tracking-[0.4em] uppercase transition-opacity duration-1000 delay-[1600ms] ${showFields ? 'opacity-100' : 'opacity-0'}`}>
          2026 © Desenvolvido por chronosR7
        </div>
      </div>

      {/* Lado Direito - A Imagem de Fundo (Apple Fade Style) */}
      <div className="hidden lg:block lg:w-[55%] relative overflow-hidden">
        <div 
          className={`absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-[10s] ease-out ${showFields ? 'scale-110' : 'scale-100'}`}
          style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1464802686167-b939a6910659?q=80&w=2050&auto=format&fit=crop")' }}
        ></div>
        
        {/* Máscaras de Gradiente para fusão perfeita */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#050505] via-[#050505]/40 to-transparent"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/20 via-transparent to-[#050505]"></div>
        
        {/* Overlay de grão/ruído sutil para textura tech */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
      </div>

    </div>
  );
};

export default Login;