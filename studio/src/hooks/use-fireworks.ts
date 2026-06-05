import confetti from 'canvas-confetti';
import React from 'react';

// Use main-thread rendering instead of the default Worker-backed confetti().
// The default export uses main.toString() to inject itself into a Blob Worker,
// which breaks when bundlers (Next.js/webpack) transform the code.
// See: https://github.com/catdad/canvas-confetti/issues/166
const fire = confetti.create(undefined, { resize: true });

const fireworks = () => {
  const duration = 2 * 1000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

  function randomInRange(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  const interval: any = setInterval(function () {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 50 * (timeLeft / duration);
    // since particles fall down, start a bit higher than random
    fire(
      Object.assign({}, defaults, {
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      }),
    );
    fire(
      Object.assign({}, defaults, {
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      }),
    );
  }, 250);
};

export const useFireworks = (shouldRun = false) => {
  const isRunning = React.useRef(false);

  React.useEffect(() => {
    if (shouldRun && !isRunning.current) {
      fireworks();
    }
  }, [shouldRun]);
};
