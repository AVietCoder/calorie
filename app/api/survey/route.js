import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedUser, requireAdmin } from '../../../lib/admin-auth.js';
import {
  SURVEY_DEMOGRAPHIC_VALUES,
  SURVEY_QUESTIONS,
  SURVEY_QUESTION_IDS,
  SURVEY_SECTIONS,
} from '../../../lib/survey.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 20;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

function validDemographics(body) {
  return Object.entries(SURVEY_DEMOGRAPHIC_VALUES).every(([field, values]) =>
    values.includes(String(body?.[field] || ''))
  );
}

function normalizedAnswers(rawAnswers) {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return null;

  const answers = [];
  for (const question of SURVEY_QUESTIONS) {
    const score = Number(rawAnswers[question.id]);
    if (!Number.isInteger(score) || score < 1 || score > 5) return null;
    answers.push({ question_id: question.id, score });
  }

  const submittedIds = Object.keys(rawAnswers);
  if (submittedIds.some((id) => !SURVEY_QUESTION_IDS.has(id))) return null;
  return answers;
}

function requestSupabase(request, includeAuthorization = true) {
  const authorization = includeAuthorization
    ? request.headers.get('authorization') || ''
    : '';
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}),
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchAll(client, table, columns, orderColumn) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(columns).range(from, from + pageSize - 1);
    if (orderColumn) query = query.order(orderColumn, { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function countBy(rows, field) {
  return rows.reduce((result, row) => {
    const value = row[field] || 'unknown';
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildAdminStats(responses, answers) {
  const questionById = new Map(SURVEY_QUESTIONS.map((question) => [question.id, question]));
  const responseById = new Map(responses.map((response) => [response.id, response]));
  const questionBuckets = new Map(
    SURVEY_QUESTIONS.map((question) => [
      question.id,
      { sum: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    ])
  );
  const sectionBuckets = new Map(
    SURVEY_SECTIONS.map((section) => [section.id, { sum: 0, count: 0 }])
  );

  let totalScore = 0;
  let positiveAnswers = 0;
  let recommendationSum = 0;
  let recommendationCount = 0;

  for (const answer of answers) {
    const question = questionById.get(answer.question_id);
    if (!question || !responseById.has(answer.response_id)) continue;
    const score = Number(answer.score);
    const questionBucket = questionBuckets.get(answer.question_id);
    const sectionBucket = sectionBuckets.get(question.sectionId);

    questionBucket.sum += score;
    questionBucket.count += 1;
    questionBucket.distribution[score] += 1;
    sectionBucket.sum += score;
    sectionBucket.count += 1;
    totalScore += score;
    if (score >= 4) positiveAnswers += 1;
    if (answer.question_id === 'all_2') {
      recommendationSum += score;
      recommendationCount += 1;
    }
  }

  const dailyMap = new Map();
  for (const response of responses) {
    const date = String(response.submitted_at || '').slice(0, 10);
    if (!date) continue;
    const item = dailyMap.get(date) || { count: 0, sum: 0 };
    item.count += 1;
    item.sum += Number(response.average_score) || 0;
    dailyMap.set(date, item);
  }

  const last30Boundary = new Date();
  last30Boundary.setDate(last30Boundary.getDate() - 30);

  return {
    summary: {
      totalResponses: responses.length,
      responsesLast30Days: responses.filter(
        (response) => new Date(response.submitted_at) >= last30Boundary
      ).length,
      averageScore: answers.length ? round(totalScore / answers.length) : 0,
      positiveRate: answers.length ? round((positiveAnswers / answers.length) * 100) : 0,
      recommendationScore: recommendationCount ? round(recommendationSum / recommendationCount) : 0,
    },
    demographics: {
      ageGroup: countBy(responses, 'age_group'),
      gender: countBy(responses, 'gender'),
      occupation: countBy(responses, 'occupation'),
      usageDuration: countBy(responses, 'usage_duration'),
      usageFrequency: countBy(responses, 'usage_frequency'),
      primaryGoal: countBy(responses, 'primary_goal'),
    },
    sectionScores: SURVEY_SECTIONS.map((section) => {
      const bucket = sectionBuckets.get(section.id);
      return {
        id: section.id,
        label: section.title,
        average: bucket.count ? round(bucket.sum / bucket.count) : 0,
      };
    }),
    questionScores: SURVEY_QUESTIONS.map((question) => {
      const bucket = questionBuckets.get(question.id);
      return {
        id: question.id,
        sectionId: question.sectionId,
        sectionLabel: question.sectionTitle,
        text: question.text,
        average: bucket.count ? round(bucket.sum / bucket.count) : 0,
        responses: bucket.count,
        distribution: bucket.distribution,
      };
    }),
    trend: Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, item]) => ({
        date,
        responses: item.count,
        average: item.count ? round(item.sum / item.count) : 0,
      })),
    recent: [...responses]
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
      .slice(0, 8)
      .map((response) => ({
        id: response.id,
        ageGroup: response.age_group,
        gender: response.gender,
        usageFrequency: response.usage_frequency,
        primaryGoal: response.primary_goal,
        averageScore: Number(response.average_score) || 0,
        comment: response.comment || '',
        submittedAt: response.submitted_at,
      })),
  };
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const answers = normalizedAnswers(body?.answers);
  const comment = String(body?.comment || '').trim();

  if (!validDemographics(body)) {
    return corsJson(NextResponse, { success: false, error: 'Vui lòng hoàn thành đầy đủ thông tin chung.' }, { status: 400 });
  }
  if (!answers) {
    return corsJson(NextResponse, { success: false, error: 'Vui lòng trả lời đầy đủ các câu hỏi đánh giá.' }, { status: 400 });
  }
  if (comment.length > 1000) {
    return corsJson(NextResponse, { success: false, error: 'Góp ý không được vượt quá 1.000 ký tự.' }, { status: 400 });
  }

  const hasAuthorization = !!request.headers.get('authorization');
  const user = hasAuthorization ? await getAuthedUser(request) : null;
  const surveyClient = requestSupabase(request, !!user);
  const { data: responseId, error: submitError } = await surveyClient.rpc('submit_survey_response', {
    p_age_group: body.ageGroup,
    p_gender: body.gender,
    p_occupation: body.occupation,
    p_usage_duration: body.usageDuration,
    p_usage_frequency: body.usageFrequency,
    p_primary_goal: body.primaryGoal,
    p_comment: comment || null,
    p_answers: Object.fromEntries(answers.map((answer) => [answer.question_id, answer.score])),
  });

  if (submitError) {
    console.error('Survey submit error:', submitError);
    return corsJson(NextResponse, {
      success: false,
      error: 'Chưa thể lưu khảo sát. Hãy kiểm tra đã chạy file migrations/survey_analytics.sql.',
    }, { status: 500 });
  }

  return corsJson(NextResponse, {
    success: true,
    responseId,
    linkedToAccount: !!user,
    message: 'Cảm ơn bạn đã hoàn thành khảo sát!',
  });
}

export async function GET(request) {
  const { user, isAdmin } = await requireAdmin(request);
  if (!user) {
    return corsJson(NextResponse, { success: false, error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }, { status: 401 });
  }
  if (!isAdmin) {
    return corsJson(NextResponse, { success: false, error: 'Bạn không có quyền xem thống kê khảo sát.' }, { status: 403 });
  }

  try {
    const surveyClient = requestSupabase(request);
    const [responses, answers] = await Promise.all([
      fetchAll(
        surveyClient,
        'survey_responses',
        'id, age_group, gender, occupation, usage_duration, usage_frequency, primary_goal, comment, average_score, submitted_at',
        'submitted_at'
      ),
      fetchAll(surveyClient, 'survey_answers', 'response_id, question_id, score'),
    ]);

    return corsJson(NextResponse, { success: true, data: buildAdminStats(responses, answers) });
  } catch (error) {
    console.error('Survey analytics error:', error);
    return corsJson(NextResponse, {
      success: false,
      error: 'Không thể tải thống kê. Hãy kiểm tra đã chạy file migrations/survey_analytics.sql.',
    }, { status: 500 });
  }
}
