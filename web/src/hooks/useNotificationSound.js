import { useState, useCallback, useSyncExternalStore } from 'react';
import notificationSound from '../utils/notificationSound';

/**
 * Hook for managing notification sound preferences.
 *
 * Returns reactive state + setter functions that sync with the
 * NotificationSoundEngine singleton and localStorage.
 */
export function useNotificationSound() {
  // Use local state to trigger re-renders when prefs change
  const [prefs, setPrefsState] = useState(() => notificationSound.getPrefs());

  const updatePrefs = useCallback((updates) => {
    notificationSound.setPrefs(updates);
    setPrefsState(notificationSound.getPrefs());
  }, []);

  const setEnabled = useCallback((enabled) => updatePrefs({ enabled }), [updatePrefs]);
  const setVolume = useCallback((volume) => updatePrefs({ volume }), [updatePrefs]);
  const setSoundType = useCallback((soundType) => updatePrefs({ soundType }), [updatePrefs]);

  const play = useCallback((options) => notificationSound.play(options), []);
  const preview = useCallback((type) => notificationSound.preview(type), []);

  const soundTypes = notificationSound.getSoundTypes();

  return {
    enabled: prefs.enabled,
    volume: prefs.volume,
    soundType: prefs.soundType,
    soundTypes,
    setEnabled,
    setVolume,
    setSoundType,
    play,
    preview,
  };
}
