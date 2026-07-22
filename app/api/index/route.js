import { NextResponse } from 'next/server';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 10;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function GET() {
  return corsJson(NextResponse, {
    status: 'ok',
    message: 'Calorie API is running 🚀',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
}
