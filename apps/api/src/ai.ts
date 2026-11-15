import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Env } from './env'

/**
 * Claude reads documents and talks to people. It never sets the status: Go / Caution / Stop
 * always comes from the rules engine, and everything Claude says is built from the engine's output.
 */

const MODEL = 'claude-opus-5-5'
// If a safety classifier declines a request, the API retries it on a fallback model inside the same call.
const fallback = () => ({ betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const })

const client = (env: Env) => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
const textOf = (content: { type: string }[]): string =>
  content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('').trim()

// ---------- Label reader ----------

export const LabelSchema = z.object({
  productName: z.string().nullable().describe('Product name as printed on the label'),
  epaRegNo: z.string().nullable().describe('EPA registration number'),
  activeIngredients: z.array(z.string()),
  windMinMph: z.number().nullable().describe('Minimum wind speed for application, mph, if the label gives one'),
  windMaxMph: z.number().nullable().describe('Maximum wind speed for application, mph, if the label gives one'),
  inversionProhibited: z.boolean().nullable().describe('True if the label prohibits application during a temperature inversion'),
  dropletSize: z.enum(['fine', 'medium', 'coarse']).nullable().describe('Required or recommended droplet size class, mapped to the nearest of fine, medium, coarse'),
  bufferFt: z.number().nullable().describe('Largest buffer or setback distance from sensitive areas, in feet'),
  volatility: z.enum(['low', 'high']).nullable().describe('high if the label warns about vapor drift or volatility, low if it does not'),
  evidence: z.array(z.object({ field: z.string(), quote: z.string() })).describe('For each non-null field above, the exact label sentence it came from'),
  notes: z.string().describe('One or two sentences on anything spray-drift related that the fields do not capture, or an empty string'),
})
export type LabelReading = z.infer<typeof LabelSchema>

const LABEL_SYSTEM = `You read pesticide product labels for Stillair, a tool that helps applicators decide whether weather conditions are safe for spraying an orchard.

The applicator will photograph or upload a label and then confirm what you extracted before it is used, so your job is to pull out the spray-drift terms accurately and show where each came from. The label is the legal authority: a value you invent or guess could lead someone to spray when the label forbids it. When the label does not state something, return null for that field instead of a typical value. Convert units to mph and feet. For every field you fill in, add an evidence entry quoting the label sentence word for word, so the applicator can check it against the paper label.

If the image is not a pesticide label or is unreadable, return null fields and say so in notes.`

export async function readLabel(env: Env, file: { data: string; mediaType: string }): Promise<{ label?: LabelReading; error?: string }> {
  const source = { type: 'base64' as const, data: file.data }
  const doc = file.mediaType === 'application/pdf'
    ? { type: 'document' as const, source: { ...source, media_type: 'application/pdf' as const } }
    : { type: 'image' as const, source: { ...source, media_type: file.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } }
  const res = await client(env).beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...fallback(),
    system: LABEL_SYSTEM,
    output_config: { effort: 'medium', format: zodOutputFormat(LabelSchema) },
    messages: [{ role: 'user', content: [doc, { type: 'text', text: 'Extract the spray-drift terms from this label.' }] }],
  })
  if (res.stop_reason === 'refusal') return { error: 'The label could not be read. Enter the limits by hand.' }
  const parsed = LabelSchema.safeParse(JSON.parse(textOf(res.content) || 'null'))
  return parsed.success ? { label: parsed.data } : { error: 'The label could not be read. Enter the limits by hand.' }
}

// ---------- Ask Stillair ----------

const ASK_SYSTEM = `You are the assistant inside Stillair, a spray-drift decision tool used by pesticide applicators and Pest Control Advisers at a pecan orchard in Sahuarita, Arizona. People ask you things from the field, often by text message while working, in English or Spanish.

Stillair measures temperature and wind at two heights on a tower in each block and applies fixed rules: an inversion (warmer air above cooler air) is a Stop, because spray hangs near the ground and travels; wind under 3 mph or over 10 mph, large differences in wind between the two heights, and wind blowing toward a sensitive site also raise the status. The status clears only after conditions stay better for 10 minutes. The Richardson number (Ri) describes whether the air is mixing: above 0.25 it is not.

Each message you receive contains a snapshot of what the tool knows right now: every block's status, the reasons, the readings, the ground station, the forecast, the next safe window, and a drift-model estimate of how much spray would leave each block and what that would cost. The status in that snapshot is decided by the rules, not by you. Your job is to explain it and answer from it. Use only the snapshot: if it does not contain the answer, say what you do not have instead of estimating. People act on what you say with pesticides near homes and schools, so never tell someone it is fine to spray a block whose status is not GO, and remind them the product label and on-site judgment come first when they ask for permission to spray.

When a block's status is not GO, or someone asks whether, why or when to spray, make the consequence concrete with the drift-model figures in the snapshot: the share of the spray that would leave the block, the dollars that represents, the extra product it would take to make up for it, and who is downwind. Describe them as model estimates, since they compare conditions and are not measurements. Where the forecast shows a better hour, say when it is and what waiting saves.

Sometimes the message includes an on_screen section. That is what the person is looking at in the app, and it may be a what-if scenario they are exploring instead of live conditions. When it says what-if, answer about that scenario, say plainly that it is hypothetical, and keep it separate from the live status.

Answer in the language of the question. Write two to four short sentences in plain text with no markdown, lists or headings, because replies are often delivered as a text message. Lead with the answer, then the reason. Give times in the orchard's local time as shown in the snapshot.`

export async function ask(env: Env, question: string, snapshot: string, onScreen?: string): Promise<string> {
  const screen = onScreen ? `<on_screen>\n${onScreen}\n</on_screen>\n\n` : ''
  const res = await client(env).beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...fallback(),
    system: [{ type: 'text', text: ASK_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `<snapshot>\n${snapshot}\n</snapshot>\n\n${screen}<question>\n${question}\n</question>` }],
  })
  if (res.stop_reason === 'refusal') return 'I can only answer questions about spray conditions at the orchard.'
  return textOf(res.content) || 'I could not work out an answer. Check the status screen in the app.'
}
