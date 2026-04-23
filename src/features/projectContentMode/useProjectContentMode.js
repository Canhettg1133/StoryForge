import { useCallback, useMemo } from 'react';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import {
  buildProjectContentModePatch,
  resolveProjectContentMode,
} from './projectContentMode';

export default function useProjectContentMode() {
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProjectSettings = useProjectStore((state) => state.updateProjectSettings);
  const resetEniPriming = useAIStore((state) => state.resetEniPriming);

  const contentMode = useMemo(
    () => resolveProjectContentMode(currentProject),
    [currentProject?.nsfw_mode, currentProject?.super_nsfw_mode],
  );

  const setContentMode = useCallback(async (nextMode) => {
    if (!updateProjectSettings) return;
    await updateProjectSettings(buildProjectContentModePatch(nextMode));
    if (resetEniPriming) {
      await resetEniPriming();
    }
  }, [resetEniPriming, updateProjectSettings]);

  return {
    currentProject,
    contentMode,
    setContentMode,
  };
}
