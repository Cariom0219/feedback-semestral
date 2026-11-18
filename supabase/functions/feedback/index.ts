// Função "feedback" do Feedback Semestral (Supabase Edge Function, sem verificação de JWT).
// Publicar: supabase functions deploy feedback --no-verify-jwt
import postgres from 'npm:postgres@3.4.5';
import { iniciar } from './servidor.js';

Deno.serve(iniciar(postgres));
