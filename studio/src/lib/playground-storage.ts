/**
 * This lib focuses on playground helpers for localStorage
 */

export function getPreFlightScript() {
  const selected = localStorage.getItem('playground:pre-flight:selected');
  const enabled = localStorage.getItem('playground:pre-flight:enabled');
  
  if (!selected || selected === 'undefined') return undefined;

  try {
    return {
      ...JSON.parse(selected),
      enabled: enabled === 'true',
    };
  } catch {
    return undefined;
  }
}
  
export function getScriptTabState(tabId: string, key: 'pre-operation' | 'post-operation') {
  const tabState = localStorage.getItem('playground:script:tabState');
  if (!tabState) return undefined;

  try {
    const parsed = JSON.parse(tabState);
    return parsed?.[tabId]?.[key];
  } catch {
    return undefined;
  }
}