import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Activity, ActivityType, Status } from './types';
import { supabase } from './lib/supabaseClient'; 
import Login from './Login';
import { 
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid 
} from 'recharts';
import * as XLSX from 'xlsx';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [modal, setModal] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  
  const [viewMode, setViewMode] = useState<'card' | 'table'>('table'); 
  const [expandedMacros, setExpandedMacros] = useState<string[]>([]);

  // --- CONTROLE DE ANIMAÇÃO ---
  const [showWelcome, setShowWelcome] = useState(false);
  const [fadeOutWelcome, setFadeOutWelcome] = useState(false);
  const [headerText, setHeaderText] = useState('');
  const typingStarted = useRef(false);
  const fullHeaderText = "Gerenciador de Tarefas - CRQ XII";

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (initialSession) {
        setSession(initialSession);
        if (!sessionStorage.getItem('welcome_done')) setShowWelcome(true);
        else { setHeaderText(fullHeaderText); typingStarted.current = true; }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_IN' && newSession) {
        setSession(newSession);
        if (!sessionStorage.getItem('welcome_done')) { setShowWelcome(true); setFadeOutWelcome(false); }
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        sessionStorage.removeItem('welcome_done');
        setShowWelcome(false);
        setHeaderText('');
        typingStarted.current = false;
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (showWelcome && !fadeOutWelcome) {
      const timer = setTimeout(() => setFadeOutWelcome(true), 1800);
      return () => clearTimeout(timer);
    }
    if (fadeOutWelcome && showWelcome) {
      const timer = setTimeout(() => {
        sessionStorage.setItem('welcome_done', 'true');
        setShowWelcome(false);
        if (!typingStarted.current) startTyping();
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [showWelcome, fadeOutWelcome]);

  const startTyping = () => {
    if (typingStarted.current) return;
    typingStarted.current = true;
    let i = 0;
    const interval = setInterval(() => {
      if (i < fullHeaderText.length) {
        setHeaderText(fullHeaderText.slice(0, i + 1));
        i++;
      } else { clearInterval(interval); }
    }, 70);
  };

  // --- MOTOR DE DADOS ---
  const fetchData = async () => {
    if (!session?.user) return;
    setLoading(true);
    const { data: sData } = await supabase.from('statuses').select('*').order('name', { ascending: true });
    const { data: aData } = await supabase.from('activities').select('*').order('created_at', { ascending: false });
    if (sData) setStatuses(sData);
    if (aData) setActivities(aData);
    setLoading(false);
  };

  useEffect(() => { if (session) fetchData(); }, [session]);

  const statusMap = useMemo(() => new Map(statuses.map(s => [s.id, s])), [statuses]);
  const macroActivities = useMemo(() => activities.filter(a => a.type === ActivityType.MACRO), [activities]);
  const filteredActivities = useMemo(() => activities.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()) && (filterStatus === 'all' || a.status_id === filterStatus)), [activities, searchTerm, filterStatus]);

  const toggleMacro = (macroId: string) => setExpandedMacros(prev => prev.includes(macroId) ? prev.filter(id => id !== macroId) : [...prev, macroId]);

  // --- CRUD ---
  const addActivity = async (activity: any) => {
    const { error } = await supabase.from('activities').insert([{ ...activity, user_id: session.user.id }]);
    if (error) alert("Erro: " + error.message); else { setModal(null); fetchData(); }
  };

  const updateActivity = async (activity: any) => {
    const { error } = await supabase.from('activities').update(activity).eq('id', activity.id);
    if (error) alert("Erro: " + error.message); else { setModal(null); fetchData(); }
  };

  // --- DATA OPS ---
  const exportToExcel = () => {
    const data = activities.map(a => ({
      "Nível": a.type, "Nome": a.name, "Pai": activities.find(p => p.id === a.macro_id)?.name || "",
      "Status": statusMap.get(a.status_id)?.name || "N/A", "Data": new Date(a.activity_date || a.created_at).toLocaleDateString('pt-BR'),
      "Descrição": a.description || "", "Dificuldades": a.difficulties || "", "Sugestões": a.suggestions || ""
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Database");
    XLSX.writeFile(wb, `Backup_Workspace_2026.xlsx`);
  };

  const downloadTemplate = () => {
    const td = [{ "Nível": "MACRO", "Nome da Atividade": "Projeto X", "Vínculo (Projeto Pai)": "", "Status": "Novo", "Data": "01/01/2026", "Descrição": "...", "Dificuldades": "", "Sugestões": "" }];
    const ws = XLSX.utils.json_to_sheet(td);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo");
    XLSX.writeFile(wb, "Modelo_Importacao.xlsx");
  };

  const handleImportData = async (file: File) => {
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const workbook = XLSX.read(e.target?.result, { type: 'binary' });
        const json: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const res = json.map(row => {
          const s = statuses.find(st => st.name.toLowerCase() === row["Status"]?.toLowerCase());
          const p = activities.find(a => a.name.toLowerCase() === row["Vínculo (Projeto Pai)"]?.toLowerCase() && a.type === ActivityType.MACRO);
          return {
            name: row["Nome da Atividade"], type: row["Nível"]?.toUpperCase() === 'MACRO' ? ActivityType.MACRO : ActivityType.MICRO,
            macro_id: p?.id || null, status_id: s ? s.id : (statuses[0]?.id || null),
            user_id: session.user.id, description: row["Descrição"], difficulties: row["Dificuldades"], suggestions: row["Sugestões"],
            activity_date: new Date().toISOString()
          };
        });
        await supabase.from('activities').insert(res);
        alert("Dados processados."); fetchData(); setModal(null);
      } catch (err: any) { alert("Erro: " + err.message); } finally { setLoading(false); }
    };
    reader.readAsBinaryString(file);
  };

  // --- MOTOR DE RELATÓRIO ELITE ---
  const generateDocxReport = (start: string, end: string) => {
    let filtered = activities;
    if (start) filtered = filtered.filter(a => new Date(a.activity_date || a.created_at) >= new Date(start));
    if (end) filtered = filtered.filter(a => new Date(a.activity_date || a.created_at) <= new Date(end));
    
    const macros = filtered.filter(a => a.type === ActivityType.MACRO);
    const micros = filtered.filter(a => a.type === ActivityType.MICRO);
    const concluded = micros.filter(a => (statusMap.get(a.status_id)?.name || "").toLowerCase().match(/finalizado|concluído|concluido/));
    const ongoing = micros.filter(a => (statusMap.get(a.status_id)?.name || "").toLowerCase().includes("andamento"));
    const meetings = micros.filter(a => a.name.toLowerCase().match(/reunião|reuniao|call|alinhamento/));
    const blockers = filtered.filter(a => a.difficulties && a.difficulties.trim() !== "");

    const efficiency = Math.round((concluded.length / (micros.length || 1)) * 100);
    const strategyRatio = Math.round((macros.length / (filtered.length || 1)) * 100);

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><style>
        @page WordSection1 { size: 21.0cm 29.7cm; margin: 2.0cm 2.0cm 2.0cm 2.0cm; }
        body { font-family: 'Calibri', 'Arial', sans-serif; color: #222; line-height: 1.5; }
        h1 { color: #1a2b4c; text-align: center; font-size: 20pt; border-bottom: 2px solid #1a2b4c; margin-bottom: 20pt; text-transform: uppercase; }
        h2 { color: #1a2b4c; border-bottom: 1px solid #1a2b4c; font-size: 14pt; margin-top: 25pt; font-weight: bold; }
        h3 { color: #333; font-size: 12pt; margin-top: 15pt; font-weight: bold; }
        .ia-box { background: #f0f4f8; padding: 15pt; border: 1px solid #1a2b4c; margin-top: 30pt; }
        .kpi-table { width: 100%; border-collapse: collapse; margin: 15pt 0; }
        .kpi-table td { border: 1px solid #eee; padding: 8pt; text-align: center; }
        .kpi-label { font-weight: bold; color: #666; font-size: 8pt; display: block; text-transform: uppercase; }
        .kpi-value { font-size: 14pt; font-weight: bold; color: #1a2b4c; }
      </style></head>
      <body><div class="WordSection1">
        <h1>Relatório de Atividades Operacionais</h1>
        <p align="right">Período: ${start || 'Início'} a ${end || 'Hoje'}<br>Emissão: ${new Date().toLocaleDateString('pt-BR')}</p>

        <table class="kpi-table">
          <tr>
            <td><span class="kpi-label">Volume Total</span><span class="kpi-value">${filtered.length}</span></td>
            <td><span class="kpi-label">Eficiência</span><span class="kpi-value">${efficiency}%</span></td>
            <td><span class="kpi-label">Reuniões</span><span class="kpi-value">${meetings.length}</span></td>
            <td><span class="kpi-label">Peso Estratégico</span><span class="kpi-value">${strategyRatio}%</span></td>
          </tr>
        </table>

        <h2>1 - LISTA DE PROJETOS MACRO</h2>
        <ul>${macros.length > 0 ? macros.map(m => `<li><strong>${m.name}</strong> (Status: ${statusMap.get(m.status_id)?.name})</li>`).join('') : '<li>Nenhum projeto macro registrado.</li>'}</ul>

        <h2>2 - ATIVIDADES SEMANAIS REALIZADAS</h2>
        <h3>2.1 - Atividades Concluídas</h3>
        <ul>${concluded.length > 0 ? concluded.map(c => `<li>${c.name}</li>`).join('') : '<li>Nenhuma atividade concluída.</li>'}</ul>
        
        <h3>2.2 - Reuniões Realizadas</h3>
        <ul>${meetings.length > 0 ? meetings.map(r => `<li>${r.name} (Status: ${statusMap.get(r.status_id)?.name})</li>`).join('') : '<li>Nenhuma reunião registrada.</li>'}</ul>

        <h3>2.3 - Atividades em Andamento</h3>
        <ul>${ongoing.length > 0 ? ongoing.map(o => `<li>${o.name}</li>`).join('') : '<li>Nenhuma atividade em trânsito.</li>'}</ul>

        <h2>3 - OBSTÁCULOS E DESAFIOS</h2>
        <ul>${blockers.length > 0 ? blockers.map(b => `<li><strong>${b.name}:</strong> ${b.difficulties}</li>`).join('') : '<li>Operação sem impedimentos reportados.</li>'}</ul>

        <div class="ia-box">
          <h2 style="margin-top:0">Análise da IA (ChronosR7 Intelligence)</h2>
          <p>O período analisado demonstra uma <strong>eficiência operacional de ${efficiency}%</strong>. ${strategyRatio < 15 ? 'Observa-se um foco excessivo em demandas reativas (micro), sugerindo a necessidade de maior alocação em projetos estruturais.' : 'O equilíbrio entre visão estratégica e execução de tarefas micro demonstra uma gestão saudável do portfólio.'}</p>
          <p><strong>Gargalos Identificados:</strong> ${blockers.length > 0 ? `A presença de ${blockers.length} obstáculos reportados indica a necessidade de intervenção imediata para destravar o fluxo produtivo.` : 'Não foram detectados impedimentos críticos que comprometam o cronograma.'}</p>
        </div>
      </div></body></html>
    `;
    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `Relatorio_Executivo_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.doc`; link.click();
  };

  if (!session) return <Login />;

  const renderModal = () => {
    if (!modal) return null;
    const closeModal = () => setModal(null);
    switch (modal.type) {
      case 'ADD_ACTIVITY': case 'EDIT_ACTIVITY':
        return <ActivityFormModal modal={modal} onClose={closeModal} statuses={statuses} onSave={(data: any) => { modal.type === 'EDIT_ACTIVITY' ? updateActivity(data) : addActivity(data); }} macroActivities={macroActivities} />;
      case 'VIEW_ACTIVITY':
        return <ActivityDetailModal activity={modal.activity} onClose={closeModal} statuses={statuses} onStatusChange={(id: string, sId: string) => { updateActivity({...modal.activity, status_id: sId}); }} onDelete={() => { if(window.confirm("Excluir?")) supabase.from('activities').delete().eq('id', modal.activity.id).then(() => fetchData()); setModal(null); }} onEdit={() => setModal({ type: 'EDIT_ACTIVITY', activity: modal.activity })} />;
      case 'MANAGE_STATUS': return <ManageStatusModal onClose={closeModal} statuses={statuses} onAddStatus={async (n: any, c: any) => { await supabase.from('statuses').insert([{ name: n, color: c, user_id: session.user.id }]); fetchData(); }} onDeleteStatus={async (id: any) => { await supabase.from('statuses').delete().eq('id', id); fetchData(); }} />;
      case 'REPORT': return <ReportModal onClose={closeModal} activities={activities} statuses={statuses} onGenerate={generateDocxReport} />;
      case 'DATA_MANAGEMENT': return <DataManagementModal onClose={closeModal} onExport={exportToExcel} onImport={handleImportData} onTemplate={downloadTemplate} />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#020205] text-gray-300 font-sans relative overflow-x-hidden">
      
      {/* --- DESIGN: GRADIENTE DE FUNDO RELAXANTE ---[cite: 1] */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {/* Glow Superior Esquerdo */}
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-blue-600/20 blur-[140px] rounded-full opacity-60" />
        {/* Glow Inferior Direito */}
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[60%] bg-cyan-500/15 blur-[120px] rounded-full opacity-50" />
        {/* Camada de Gradiente Radial para suavizar o centro */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_#020205_85%)]" />
      </div>

      <style>{`
        @keyframes appleReveal { 0% { opacity: 0; transform: scale(0.96) translateY(10px); filter: blur(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); } }
        .animate-apple-reveal { animation: appleReveal 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .glass-panel { background: rgba(15, 15, 20, 0.7); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.05); }
        select { appearance: none; background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right 1rem center; background-size: 1em; }
      `}</style>

      {showWelcome && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#020205] transition-opacity duration-1000 ease-in-out ${fadeOutWelcome ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <h1 className="animate-apple-reveal text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-cyan-300 tracking-tighter select-none uppercase tracking-[0.3em]">ACESSO AUTORIZADO</h1>
        </div>
      )}

      {/* CONTEÚDO (RELATIVE Z-10 PARA FICAR ACIMA DO GRADIENTE) */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="bg-black/40 backdrop-blur-lg border-b border-white/5 sticky top-0 z-40">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex justify-between items-center">
            <div className="font-extrabold tracking-widest uppercase text-lg bg-clip-text text-transparent bg-gradient-to-r from-blue-500 via-blue-300 to-cyan-300 min-w-[200px]">
              {headerText}<span className={`text-cyan-400 ${headerText === fullHeaderText ? 'hidden' : 'animate-pulse'}`}>|</span>
            </div>
            <div className="flex items-center space-x-3 text-sm">
              <button onClick={() => setModal({ type: 'MANAGE_STATUS' })} className="px-4 py-2 hover:bg-white/5 border border-white/10 rounded-lg text-xs font-bold uppercase transition-all">Status</button>
              <button onClick={() => setModal({ type: 'DATA_MANAGEMENT' })} className="px-4 py-2 hover:bg-white/5 border border-white/10 rounded-lg text-xs font-bold uppercase transition-all">Dados</button>
              <button onClick={() => setModal({ type: 'REPORT' })} className="px-4 py-2 bg-gradient-to-r from-blue-700 to-cyan-600 rounded-lg font-bold text-xs uppercase shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all">Relatórios</button>
              <button onClick={() => supabase.auth.signOut()} className="px-4 py-2 bg-red-900/20 text-red-400 border border-red-900/50 rounded-lg text-xs font-bold uppercase hover:bg-red-500 hover:text-white transition-all">Sair</button>
            </div>
          </div>
        </header>

        <main className="max-w-[1400px] mx-auto w-full p-6 pt-8 flex-1">
          {/* BARRA DE FERRAMENTAS CENTRALIZADA[cite: 1] */}
          <div className="glass-panel p-4 rounded-2xl flex flex-wrap items-center justify-center gap-6 mb-6 shadow-xl">
              <div className="flex bg-black/40 rounded-xl border border-white/5 p-1">
                <button onClick={() => setViewMode('table')} className={`px-5 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${viewMode === 'table' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-600 hover:text-gray-300'}`}>Grade</button>
                <button onClick={() => setViewMode('card')} className={`px-5 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${viewMode === 'card' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-600 hover:text-gray-300'}`}>Painel</button>
              </div>
              <button onClick={() => setModal({ type: 'ADD_ACTIVITY' })} className="bg-gradient-to-r from-blue-700 to-cyan-500 text-white px-8 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(6,182,212,0.3)] active:scale-95 transition-all">+ NOVA ATIVIDADE</button>
          </div>

          {viewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {macroActivities.map(macro => (
                <div key={macro.id} className="glass-panel p-5 border-t-4 shadow-lg" style={{ borderTopColor: statusMap.get(macro.status_id)?.color || '#374151' }}>
                  <h2 onClick={() => setModal({type: 'VIEW_ACTIVITY', activity: macro})} className="text-sm font-bold text-gray-100 cursor-pointer hover:text-cyan-400 mb-4 line-clamp-2 uppercase tracking-wide">{macro.name}</h2>
                  <div className="space-y-3 mb-4">
                      {activities.filter(a => a.macro_id === macro.id).map(micro => (
                        <div key={micro.id} onClick={() => setModal({type: 'VIEW_ACTIVITY', activity: micro})} className="bg-black/30 p-2 border border-white/5 rounded-lg cursor-pointer hover:bg-black/50 transition-all flex justify-between items-center group">
                          <span className="text-xs truncate mr-2 group-hover:text-cyan-400">└ {micro.name}</span>
                          <div className="w-2 h-2 rounded-full" style={{backgroundColor: statusMap.get(micro.status_id)?.color}} />
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl overflow-x-auto">
              <table className="min-w-full text-left text-sm border-collapse">
                <thead className="bg-black/40 border-b border-white/5 text-gray-500 uppercase text-[10px] font-black tracking-widest">
                  <tr><th className="px-6 py-4">Identificação</th><th className="px-6 py-4">Classe</th><th className="px-6 py-4">Status</th><th className="px-6 py-4 text-right">Ação</th></tr>
                </thead>
                <tbody>
                  {macroActivities.map(macro => (
                    <React.Fragment key={macro.id}>
                      <tr className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer" onClick={() => toggleMacro(macro.id)}>
                        <td className="px-6 py-4 font-bold text-gray-200 flex items-center gap-3">
                          <span className="text-cyan-500 text-[10px]">{expandedMacros.includes(macro.id) ? '▼' : '▶'}</span> {macro.name}
                        </td>
                        <td className="px-6 py-4 text-[9px] font-black uppercase text-gray-600 tracking-tighter">Macro</td>
                        <td className="px-6 py-4"><span className="text-[10px] px-2 py-0.5 rounded text-white font-bold" style={{ backgroundColor: statusMap.get(macro.status_id)?.color || '#333' }}>{statusMap.get(macro.status_id)?.name || 'N/A'}</span></td>
                        <td className="px-6 py-4 text-right"><button onClick={(e) => { e.stopPropagation(); setModal({type: 'VIEW_ACTIVITY', activity: macro}); }} className="text-cyan-500 font-bold hover:underline uppercase text-[10px]">Ver</button></td>
                      </tr>
                      {expandedMacros.includes(macro.id) && activities.filter(a => a.macro_id === macro.id).map(micro => (
                        <tr key={micro.id} className="bg-black/20 border-b border-white/[0.02] group">
                          <td className="px-6 py-3 pl-12 text-gray-400 italic">└ {micro.name}</td>
                          <td className="px-6 py-3 text-[9px] text-gray-600 font-black uppercase">Micro</td>
                          <td className="px-6 py-3"><span className="text-[10px] px-2 py-0.5 rounded text-white opacity-60 font-black" style={{ backgroundColor: statusMap.get(micro.status_id)?.color || '#333' }}>{statusMap.get(micro.status_id)?.name || 'N/A'}</span></td>
                          <td className="px-6 py-3 text-right"><button onClick={() => setModal({type: 'VIEW_ACTIVITY', activity: micro})} className="text-cyan-800 hover:text-cyan-400 font-black uppercase text-[10px]">Abrir</button></td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
        {renderModal()}
      </div>
    </div>
  );
};

// --- COMPONENTES UI RESTAURADOS ---[cite: 1]

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex justify-center items-center z-[110] p-4">
    <div className="bg-[#0f0f13] rounded-xl border border-gray-800 w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
      <div className="flex justify-between items-center p-4 px-6 border-b border-gray-800 bg-[#0a0a0a] flex-shrink-0">
        <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{title}</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-red-400 text-xl font-bold">&times;</button>
      </div>
      <div className="p-8 overflow-y-auto custom-scrollbar">{children}</div>
    </div>
  </div>
);

const ActivityFormModal: React.FC<any> = ({ modal, onClose, onSave, macroActivities, statuses }) => {
  const isEdit = modal.type === 'EDIT_ACTIVITY';
  const [name, setName] = useState(isEdit ? modal.activity.name : '');
  const [type, setType] = useState(isEdit ? modal.activity.type : ActivityType.MICRO);
  const [macroId, setMacroId] = useState(isEdit ? modal.activity.macro_id : (modal.macroId || ''));
  const [statusId, setStatusId] = useState(isEdit ? modal.activity.status_id : (statuses[0]?.id || ''));
  const [date, setDate] = useState(isEdit ? (modal.activity.activity_date || '') : new Date().toISOString().split('T')[0]);
  const [desc, setDesc] = useState(isEdit ? modal.activity.description : '');
  const [diff, setDiff] = useState(isEdit ? modal.activity.difficulties : '');
  const [sugg, setSugg] = useState(isEdit ? modal.activity.suggestions : '');

  const fClass = "w-full mt-1.5 p-3 bg-[#050505] border border-gray-700 rounded-lg text-sm text-white outline-none focus:border-cyan-500 transition-all shadow-inner";
  const lClass = "text-[10px] font-black text-gray-500 uppercase block mb-1";

  return (
    <Modal title={isEdit ? "Modificar Item" : "Novo Registro Operacional"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ ...modal.activity, name, type, macro_id: macroId, status_id: statusId, activity_date: date, description: desc, difficulties: diff, suggestions: sugg }); }} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lClass}>Hierarquia</label><select className={fClass} value={type} onChange={e => setType(e.target.value as any)}><option value={ActivityType.MICRO}>Micro (Tarefa)</option><option value={ActivityType.MACRO}>Macro (Projeto)</option></select></div>
          <div><label className={lClass}>Status Inicial</label><select className={fClass} value={statusId} onChange={e => setStatusId(e.target.value)} required>{statuses.map((s:any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        </div>
        {type === ActivityType.MICRO && (<div><label className={lClass}>Vínculo com Projeto</label><select className={fClass} value={macroId} onChange={e => setMacroId(e.target.value)} required><option value="">-- Selecione o Pai --</option>{macroActivities.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>)}
        <div><label className={lClass}>Título</label><input className={fClass} value={name} onChange={e => setName(e.target.value)} required placeholder="Ex: Call de Alinhamento..." /></div>
        <div><label className={lClass}>Data Base</label><input type="date" className={fClass} value={date} onChange={e => setDate(e.target.value)} required /></div>
        <div><label className={lClass}>Escopo Operacional</label><textarea className={fClass} rows={2} value={desc} onChange={e => setDesc(e.target.value)} /></div>
        <div><label className={lClass}>Gargalos / Impedimentos</label><textarea className={fClass} rows={2} value={diff} onChange={e => setDiff(e.target.value)} /></div>
        <div><label className={lClass}>Output / Resultados</label><textarea className={fClass} rows={2} value={sugg} onChange={e => setSugg(e.target.value)} /></div>
        <div className="pt-6 flex justify-end gap-3 border-t border-gray-800">
          <button type="button" onClick={onClose} className="px-5 py-2 text-xs font-bold text-gray-500 uppercase tracking-widest">Abortar</button>
          <button type="submit" className="bg-gradient-to-r from-blue-700 to-cyan-500 text-white px-8 py-2 rounded-lg font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-cyan-500/10 active:scale-95 transition-all">Commit Data</button>
        </div>
      </form>
    </Modal>
  );
};

const ActivityDetailModal: React.FC<any> = ({ activity, onClose, statuses, onStatusChange, onDelete, onEdit }) => (
  <Modal title="Inspetor de Dados" onClose={onClose}>
    <div className="space-y-6">
      <h3 className="text-2xl font-black text-white border-b border-gray-800 pb-4 tracking-tighter uppercase">{activity.name}</h3>
      <div className="bg-[#050505] p-5 border border-gray-800 rounded-lg text-sm space-y-4 shadow-inner">
        <div><span className="text-cyan-500 font-bold uppercase text-[9px] block mb-1 tracking-widest">Escopo Operacional</span><p className="text-gray-300 leading-relaxed">{activity.description || 'Nenhum detalhe informado.'}</p></div>
        <div><span className="text-amber-500 font-bold uppercase text-[9px] block mb-1 tracking-widest">Gargalos Reportados</span><p className="text-gray-300 leading-relaxed">{activity.difficulties || 'Sem restrições reportadas.'}</p></div>
        <div><span className="text-emerald-500 font-bold uppercase text-[9px] block mb-1 tracking-widest">Entregas Finais</span><p className="text-gray-300 leading-relaxed">{activity.suggestions || 'Em fase de processamento.'}</p></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {statuses.map((s: any) => (
          <button key={s.id} onClick={() => onStatusChange(activity.id, s.id)} className={`p-2 border rounded text-[9px] font-black uppercase transition-all ${activity.status_id === s.id ? 'bg-cyan-900/20 border-cyan-500 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'border-gray-800 text-gray-600 hover:border-gray-500'}`}>{s.name}</button>
        ))}
      </div>
      <div className="flex gap-3 pt-6 border-t border-gray-800">
        <button onClick={onEdit} className="flex-1 bg-gray-800 text-white py-2 rounded font-bold text-xs uppercase hover:bg-gray-700">Editar</button>
        <button onClick={onDelete} className="bg-red-900/20 text-red-500 px-6 py-2 rounded font-bold text-xs uppercase border border-red-900/50">Remover</button>
      </div>
    </div>
  </Modal>
);

const ManageStatusModal: React.FC<any> = ({ onClose, statuses, onAddStatus, onDeleteStatus }) => {
  const [n, setN] = useState(''); const [c, setC] = useState('#06b6d4');
  return (
    <Modal title="Configuração de Status" onClose={onClose}>
      <div className="space-y-4">
        <div className="max-h-60 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
          {statuses.map((s: any) => (
            <div key={s.id} className="flex justify-between items-center p-3 bg-[#0a0a0a] rounded border border-gray-800 group transition-all">
              <div className="flex items-center gap-3"><div className="w-1 h-6 rounded-full shadow-[0_0_8px]" style={{ backgroundColor: s.color, boxShadow: `0 0 10px ${s.color}66` }} /><span className="text-xs font-black text-gray-200 uppercase tracking-widest">{s.name}</span></div>
              <button onClick={() => onDeleteStatus(s.id)} className="text-red-900 group-hover:text-red-500 text-[10px] font-black uppercase transition-colors tracking-tighter">Remover</button>
            </div>
          ))}
        </div>
        <div className="flex gap-3 p-4 bg-[#0a0a0a] rounded-lg border border-gray-800 mt-6 shadow-inner">
          <input className="flex-1 bg-transparent text-sm text-white outline-none border-b border-gray-800 focus:border-cyan-500 transition-all" placeholder="Novo Status..." value={n} onChange={e => setN(e.target.value)} />
          <input type="color" value={c} onChange={e => setC(e.target.value)} className="w-10 h-10 bg-transparent cursor-pointer rounded border border-gray-700 p-1" />
          <button onClick={() => { if(n) onAddStatus(n, c); setN(''); }} className="bg-blue-600 px-4 rounded font-black shadow-lg hover:bg-blue-500">+</button>
        </div>
      </div>
    </Modal>
  );
};

const DataManagementModal: React.FC<any> = ({ onClose, onExport, onImport, onTemplate }) => {
  const [file, setFile] = useState<File | null>(null);
  const cardClass = "bg-[#0a0a0a] border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-all";
  const labelClass = "text-[10px] font-black tracking-widest uppercase mb-1 block";
  return (
    <Modal title="Terminal de Dados / Data Ops" onClose={onClose}>
      <div className="space-y-6">
        <div className={cardClass}><div className="flex justify-between items-start gap-4"><div><span className={`${labelClass} text-cyan-500`}>Backup Estrutural</span><h3 className="text-sm font-bold text-gray-200 mb-1">Exportar Base Total</h3><p className="text-xs text-gray-500 leading-relaxed">Snapshot completo em formato .XLSX.</p></div><button onClick={onExport} className="bg-cyan-500/10 border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500 hover:text-black px-4 py-2 rounded-lg font-black text-[10px] uppercase transition-all">GERAR BACKUP (.XLSX)</button></div></div>
        <div className={cardClass}><span className={`${labelClass} text-amber-500`}>Ingestão Massiva</span><h3 className="text-sm font-bold text-gray-200 mb-1">Processamento de Lote</h3><div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-4 flex items-center justify-between"><span className="text-[10px] text-amber-500 italic">Vincule via nome exato.</span><button onClick={onTemplate} className="text-[10px] font-black text-amber-500 underline uppercase hover:text-amber-300">Baixar Modelo</button></div>
          <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-800 rounded-xl cursor-pointer bg-[#050505] hover:border-cyan-500/50 transition-all mb-4 text-center p-2"><span className="text-xl mb-1">{file ? '📄' : '📁'}</span><p className="text-[10px] font-bold text-gray-500 uppercase truncate w-full">{file ? file.name : 'Vincular Arquivo .XLSX'}</p><input type="file" accept=".xlsx" className="hidden" onChange={e => setFile(e.target.files ? e.target.files[0] : null)} /></label>
          <button onClick={() => onImport(file)} disabled={!file} className={`w-full py-3 rounded-lg font-black text-xs uppercase tracking-widest ${file ? 'bg-gradient-to-r from-blue-700 to-cyan-500 text-white shadow-lg active:scale-95' : 'bg-gray-800 text-gray-600 opacity-50'}`}>Iniciar Carga de Dados</button>
        </div>
      </div>
    </Modal>
  );
};

const ReportModal: React.FC<any> = ({ onClose, activities, statuses, onGenerate }) => {
  const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const data = statuses.map(s => ({ 
    name: s.name, 
    value: activities.filter(a => a.status_id === s.id).length, 
    color: s.color 
  })).filter(i => i.value > 0);

  return (
    <Modal title="Analytics Engine" onClose={onClose}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 border border-gray-800 bg-[#050505] rounded-xl p-4 flex flex-col items-center shadow-inner">
            <span className="text-[9px] font-black uppercase text-gray-500 mb-2 tracking-widest">Distribuição Proporcional</span>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={data} innerRadius={45} outerRadius={60} dataKey="value" stroke="none" paddingAngle={5}>{data.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip contentStyle={{backgroundColor: '#0a0a0a', border: 'none'}} /><Legend verticalAlign="bottom" height={36} wrapperStyle={{fontSize: '8px', paddingTop: '15px'}} /></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64 border border-gray-800 bg-[#050505] rounded-xl p-4 flex flex-col items-center shadow-inner">
            <span className="text-[9px] font-black uppercase text-gray-500 mb-2 tracking-widest">Volume por Status</span>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: -10, right: 10 }}><XAxis type="number" hide /><YAxis dataKey="name" type="category" stroke="#666" fontSize={8} width={80} /><Tooltip cursor={{fill: 'transparent'}} contentStyle={{backgroundColor: '#0a0a0a', border: 'none'}} /><Bar dataKey="value" radius={[0, 4, 4, 0]}>{data.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="border-t border-gray-800 pt-6 space-y-4">
          <p className="text-[10px] font-black uppercase text-gray-500 tracking-[0.3em] text-center">Extração Executiva (.DOCX)</p>
          <div className="grid grid-cols-2 gap-4">
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className="w-full bg-[#050505] border border-gray-700 p-2.5 rounded-lg text-xs text-white outline-none focus:border-cyan-500" />
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="w-full bg-[#050505] border border-gray-700 p-2.5 rounded-lg text-xs text-white outline-none focus:border-cyan-500" />
          </div>
          <button onClick={() => onGenerate(start, end)} className="w-full bg-blue-600 text-white py-4 rounded-xl font-black text-[11px] uppercase tracking-[0.2em] shadow-lg hover:bg-blue-500 active:scale-95 transition-all border border-blue-500">Gerar Ofício Oficial (.DOCX)</button>
        </div>
      </div>
    </Modal>
  );
};

export default App;