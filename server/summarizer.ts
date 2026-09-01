import OpenAI from 'openai'
import { summarizeWork } from '../src/lib/summary.js'

export type SummaryResult = {
  completed: string
  progress: string
  tomorrow: string
  provider: 'deepseek' | 'local' | 'local-fallback'
  warning?: string
}

export interface Summarizer {
  summarize(input: string): Promise<SummaryResult>
}

class LocalSummarizer implements Summarizer {
  constructor(private readonly provider: SummaryResult['provider'] = 'local', private readonly warning?: string) {}

  async summarize(input: string): Promise<SummaryResult> {
    return { ...summarizeWork(input), provider: this.provider, warning: this.warning }
  }
}

class DeepSeekSummarizer implements Summarizer {
  private readonly client: OpenAI

  constructor(apiKey: string, private readonly model: string, baseURL: string) {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async summarize(input: string): Promise<SummaryResult> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        store: false,
        instructions: [
          '你是 Molife 的工作整理助手。',
          '把用户今天的工作记录整理成简洁、客观、温和的中文工作留痕。',
          '不要夸大成果，不要添加用户没有提供的事实，每个字段最多两句话。',
        ].join('\n'),
        input,
        text: {
          format: {
            type: 'json_schema',
            name: 'molife_work_summary',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                completed: { type: 'string', description: '今天已经完成的工作' },
                progress: { type: 'string', description: '仍在推进或等待的工作' },
                tomorrow: { type: 'string', description: '明天计划继续处理的工作' },
              },
              required: ['completed', 'progress', 'tomorrow'],
            },
          },
        },
      })
      const parsed = JSON.parse(response.output_text) as Omit<SummaryResult, 'provider'>
      return { ...parsed, provider: 'deepseek' }
    } catch {
      return new LocalSummarizer('local-fallback', 'AI 暂时不可用，已自动切换为本地整理；你仍然可以修改结果或直接领票。').summarize(input)
    }
  }
}

export function createSummarizer(config: { apiKey?: string; model: string; baseURL: string }): Summarizer {
  if (!config.apiKey) return new LocalSummarizer('local', '尚未配置 DEEPSEEK_API_KEY，当前使用本地整理。')
  return new DeepSeekSummarizer(config.apiKey, config.model, config.baseURL)
}
