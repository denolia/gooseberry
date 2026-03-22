type LanguagePairConfig<Source extends string, Target extends string> = {
  defaultSource: Source;
  defaultTarget: Target;
  sourceOptions: readonly Source[];
  targetOptions: readonly Target[];
  isSource: (value: unknown) => value is Source;
  isTarget: (value: unknown) => value is Target;
};

type LanguagePairState<Source extends string, Target extends string> = {
  currentSource: Source;
  currentTarget: Target;
  previousSource: Source;
  previousTarget: Target;
};

function isSameLanguage(left: string, right: string) {
  return left === right;
}

function pickFallbackSource<Source extends string, Target extends string>(
  state: LanguagePairState<Source, Target>,
  nextTarget: Target,
  config: LanguagePairConfig<Source, Target>,
): Source {
  if (
    config.isSource(state.currentTarget) &&
    !isSameLanguage(state.currentTarget, nextTarget)
  ) {
    return state.currentTarget;
  }

  if (!isSameLanguage(state.previousSource, nextTarget)) {
    return state.previousSource;
  }

  if (!isSameLanguage(config.defaultSource, nextTarget)) {
    return config.defaultSource;
  }

  return (
    config.sourceOptions.find((option) => !isSameLanguage(option, nextTarget)) ??
    config.defaultSource
  );
}

function pickFallbackTarget<Source extends string, Target extends string>(
  state: LanguagePairState<Source, Target>,
  nextSource: Source,
  config: LanguagePairConfig<Source, Target>,
): Target {
  if (
    config.isTarget(state.currentSource) &&
    !isSameLanguage(state.currentSource, nextSource)
  ) {
    return state.currentSource;
  }

  if (!isSameLanguage(state.previousTarget, nextSource)) {
    return state.previousTarget;
  }

  if (!isSameLanguage(config.defaultTarget, nextSource)) {
    return config.defaultTarget;
  }

  return (
    config.targetOptions.find((option) => !isSameLanguage(option, nextSource)) ??
    config.defaultTarget
  );
}

export function updateLanguagePairForSourceChange<
  Source extends string,
  Target extends string,
>(
  state: LanguagePairState<Source, Target>,
  nextSource: Source,
  config: LanguagePairConfig<Source, Target>,
): LanguagePairState<Source, Target> {
  if (nextSource === state.currentSource) {
    return state;
  }

  return {
    currentSource: nextSource,
    currentTarget: isSameLanguage(nextSource, state.currentTarget)
      ? pickFallbackTarget(state, nextSource, config)
      : state.currentTarget,
    previousSource: state.currentSource,
    previousTarget: state.currentTarget,
  };
}

export function updateLanguagePairForTargetChange<
  Source extends string,
  Target extends string,
>(
  state: LanguagePairState<Source, Target>,
  nextTarget: Target,
  config: LanguagePairConfig<Source, Target>,
): LanguagePairState<Source, Target> {
  if (nextTarget === state.currentTarget) {
    return state;
  }

  return {
    currentSource: isSameLanguage(nextTarget, state.currentSource)
      ? pickFallbackSource(state, nextTarget, config)
      : state.currentSource,
    currentTarget: nextTarget,
    previousSource: state.currentSource,
    previousTarget: state.currentTarget,
  };
}
