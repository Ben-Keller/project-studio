import React from 'react';
import { createRoot } from 'react-dom/client';
import { StyleSheetManager } from 'styled-components';
import { WalkthroughMount } from './WalkthroughMount';
import { hydrateRecordingLibrary } from './storage';
import { runtimeConfig, setOverlayRoot } from './runtime';

const mount = async () => {
  if (document.getElementById('local-walkthrough-studio-root')) return;
  const host = document.createElement('div');
  host.id = 'local-walkthrough-studio-root';
  host.setAttribute('data-walkthrough-recorder', 'true');
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  document.body.appendChild(host);
  document.documentElement.setAttribute('data-project-studio-document', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const reset = document.createElement('style');
  reset.textContent = ':host{font:14px sans-serif;color:#18202b}*,*::before,*::after{box-sizing:border-box}button,input,select{font:inherit}';
  shadow.appendChild(reset);
  const root = document.createElement('div');
  const overlays = document.createElement('div');
  shadow.append(root, overlays);
  setOverlayRoot(overlays);
  try {
    await hydrateRecordingLibrary();
    const config = runtimeConfig();
    if (config?.readySelector) {
      const deadline = Date.now() + 60000;
      while (!document.querySelector(config.readySelector)) {
        if (Date.now() > deadline) throw new Error(`App did not become ready: ${config.readySelector}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    if (config?.language) await (window.__projectStudioAdapter || window.__moonshotWalkthroughState)?.applyState({ language: config.language });
    createRoot(root).render(
      <StyleSheetManager target={shadow as unknown as HTMLElement}>
        <WalkthroughMount initialRecorderActive={!config?.exportOnly} recorderShortcut />
      </StyleSheetManager>,
    );
  } catch (error) {
    root.style.cssText = 'pointer-events:auto;background:white;color:#a00;padding:20px;position:absolute;top:20px;left:20px;max-width:480px';
    root.textContent = `Recording Studio could not open: ${String(error)}. Your existing recordings have not been removed. Reload to retry.`;
  }
};

if (document.body) void mount();
else document.addEventListener('DOMContentLoaded', () => { void mount(); }, { once: true });
