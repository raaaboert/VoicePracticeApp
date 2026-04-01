export type PostCommitEffectCategory = "security_cleanup" | "post_commit_cleanup";

export interface PostCommitEffect {
  category: PostCommitEffectCategory;
  description: string;
  run: () => Promise<void>;
}

export interface PostCommitEffectRegistry<TContext extends object> {
  queue(context: TContext, effect: PostCommitEffect): void;
  drain(context: TContext): PostCommitEffect[];
  discard(context: TContext): void;
}

export function createPostCommitEffectRegistry<TContext extends object>(): PostCommitEffectRegistry<TContext> {
  const effectsByContext = new WeakMap<TContext, PostCommitEffect[]>();

  return {
    queue(context: TContext, effect: PostCommitEffect): void {
      const pending = effectsByContext.get(context);
      if (pending) {
        pending.push(effect);
        return;
      }

      effectsByContext.set(context, [effect]);
    },
    drain(context: TContext): PostCommitEffect[] {
      const pending = effectsByContext.get(context) ?? [];
      effectsByContext.delete(context);
      return pending;
    },
    discard(context: TContext): void {
      effectsByContext.delete(context);
    }
  };
}

export async function runPostCommitEffects(
  effects: readonly PostCommitEffect[],
  options?: {
    onFailure?: (effect: PostCommitEffect, error: unknown) => void;
  }
): Promise<void> {
  for (const effect of effects) {
    try {
      await effect.run();
    } catch (error) {
      options?.onFailure?.(effect, error);
    }
  }
}
