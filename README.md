# Gerenciador de Tarefas - CRQ-12

Painel institucional para acompanhamento de tarefas, projetos, prazos, status, processos SEI e anotações internas.

## Requisitos

- Node.js 20
- Projeto Supabase com autenticação habilitada
- Tabelas `activities` e `statuses` já utilizadas pelo sistema

## Configuração local

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie o arquivo `.env` a partir de `.env.example` e preencha:

   ```env
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
   ```

3. Inicie o projeto:

   ```bash
   npm run dev
   ```

## Banco de dados

Execute `supabase_activity_extra_fields.sql` no SQL Editor do Supabase para criar os campos opcionais:

- `processo_sei`
- `internal_notes`

O script usa `add column if not exists` e preserva os registros existentes.

As tabelas devem usar Row Level Security (RLS) e políticas compatíveis com `user_id`. As chaves de serviço do Supabase nunca devem ser expostas no frontend; use somente a chave pública anônima em `VITE_SUPABASE_ANON_KEY`.

## Recuperação de senha

Em **Supabase > Authentication > URL Configuration**, configure a URL publicada do sistema em `Site URL` e `Redirect URLs`. Exemplo:

```text
https://seu-site.netlify.app/**
```

## Validação

```bash
npm run typecheck
npm run build
npm audit
```

O comando de build executa o TypeScript antes de gerar `dist`.

## Netlify

O arquivo `netlify.toml` configura:

- build com `npm run build`;
- publicação da pasta `dist`;
- Node.js 20;
- fallback para a aplicação React;
- cabeçalhos básicos de segurança.

As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` devem ser cadastradas também nas variáveis de ambiente do Netlify.
