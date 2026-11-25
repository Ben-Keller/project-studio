import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WalkthroughMount } from '../src/WalkthroughMount';

function Fixture() {
  const [clicks, setClicks] = useState(0);
  return <>
    <header id='fixed-header' style={{ position: 'fixed', top: 0, width: '100%', height: 50, background: '#16445b', color: 'white' }}>Walkthrough rendering check</header>
    <main style={{ padding: '150px 100px', minHeight: 2000, background: '#e5edf2' }}>
      <button data-walkthrough-target='test-button' onClick={() => setClicks(value => value + 1)} style={{ width: 300, height: 100, cursor: 'pointer' }}>Clicks: <span id='click-count'>{clicks}</span></button>
      <p>Circle highlights cross this text and the button without changing cursor shape.</p>
      <input data-walkthrough-target='test-input' defaultValue='Recorded text' />
    </main>
    <WalkthroughMount />
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
