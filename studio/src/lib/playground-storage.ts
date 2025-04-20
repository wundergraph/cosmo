/**
 * This lib focuses on playground helpers for localStorage
 */
import { PostOperationUrlState, PreFlightUrlState, PreOperationUrlState } from "@/components/playground/types";

export const getPreFlightScript = () => {
  const selected = localStorage.getItem('playground:pre-flight:selected');
  const enabled = localStorage.getItem('playground:pre-flight:enabled');
  
  if (!selected || selected === 'undefined') return undefined;

  try {
    return {
      ...JSON.parse(selected),
      enabled: enabled === 'true',
    };
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Failed to parse pre-flight script:', e);
    }

    return undefined;
  }
}
  
export const getScriptTabState = (
  tabId: string,
  key: 'pre-operation' | 'post-operation'
) => {
  const tabState = localStorage.getItem('playground:script:tabState');
  if (!tabState) return undefined;

  try {
    const parsed = JSON.parse(tabState);
    return parsed?.[tabId]?.[key];
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Failed to parse script tab state:${key}:`, e);
    }

    return undefined;
  }
}

export const setPreFlightScript = (
  preFlight: PreFlightUrlState
) => {
  if (!preFlight) return;

  try {
    localStorage.setItem('playground:pre-flight:enabled', JSON.stringify(preFlight.enabled));
    if (preFlight.content) {
      localStorage.setItem(
        'playground:pre-flight:selected',
        JSON.stringify(preFlight, (key, value) => (key === 'enabled' ? undefined : value))
      );
    }
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Failed to set pre-flight script:', e);
    }
  }
}

export const setScriptTabState = (
  key: 'pre-operation' | 'post-operation',
  content: PreOperationUrlState | PostOperationUrlState,
  tabId?: string
) => {
  if (!tabId) return;

  try {
    const tabState = localStorage.getItem('playground:script:tabState');
    const parsed = tabState ? JSON.parse(tabState) : {};

    if (!parsed[tabId]) parsed[tabId] = {};
    parsed[tabId][key] = content;

    localStorage.setItem('playground:script:tabState', JSON.stringify(parsed));
    localStorage.setItem(`playground:${key}:selected`, JSON.stringify(content));
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.error(`Failed to set script tab state:${key}:`, e);
    }
  }
}