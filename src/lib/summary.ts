export type WorkSummary = {
  completed: string
  progress: string
  tomorrow: string
}

const tidy = (value: string) => value.replace(/^[-*\d.、\s]+/, '').trim()

export function summarizeWork(input: string): WorkSummary {
  const items = input
    .split(/\n+|[。；;]/)
    .map(tidy)
    .filter(Boolean)

  if (items.length === 0) {
    return {
      completed: '今天按自己的节奏完成了工作。',
      progress: '重要的事情正在继续向前。',
      tomorrow: '明天再从容地接着做。',
    }
  }

  const completed = items[0]
  const progress = items[1] ?? '手上的事项都在按计划推进。'
  const tomorrow = items[2] ?? '明天继续处理剩余事项。'

  return {
    completed: completed.endsWith('。') ? completed : `${completed}。`,
    progress: progress.endsWith('。') ? progress : `${progress}。`,
    tomorrow: tomorrow.endsWith('。') ? tomorrow : `${tomorrow}。`,
  }
}

