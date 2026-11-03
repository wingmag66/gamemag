import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine, GameState, SpellId } from './game/GameEngine';

// Create a single engine instance
const engine = new GameEngine();

// Detect test mode
const testMode = new URLSearchParams(window.location.search).get('test') === '1';

// Expose window.game API
(window as any).game = {
  start: () => engine.start(),
  reset: () => engine.reset(),
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  cast: (spellId: SpellId) => engine.cast(spellId),
  tick: (dt: number) => engine.tick(dt),
  getState: () => engine.getState(),
  spawnMonster: (type: any, x: number) => engine.spawnMonster(type, x),
  setMana: (value: number) => engine.setMana(value),
  setMageHp: (value: number) => engine.setMageHp(value),
  clearMonsters: () => engine.clearMonsters(),
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [mana, setMana] = useState(100);
  const [mageHp, setMageHp] = useState(3);
  const [cooldowns, setCooldowns] = useState({ fireball: 0, frostbolt: 0, lightning: 0 });
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const updateUI = useCallback(() => {
    const state = engine.getState();
    setGameState(state.state);
    setScore(state.score);
    setWave(state.wave);
    setMana(state.mana);
    setMageHp(state.mageHp);
    setCooldowns({ ...state.cooldowns });
  }, []);

  useEffect(() => {
    if (canvasRef.current) {
      engine.setCanvas(canvasRef.current);
      engine.setStateChangeCallback(updateUI);

      lastTimeRef.current = performance.now();

      const loop = (time: number) => {
        const dt = (time - lastTimeRef.current) / 1000;
        lastTimeRef.current = time;

        if (!testMode) {
          // Normal mode: tick the game
          engine.tick(dt);
        }
        // Always render
        engine.render();

        animFrameRef.current = requestAnimationFrame(loop);
      };

      animFrameRef.current = requestAnimationFrame(loop);

      return () => {
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
        }
      };
    }
  }, [updateUI]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '1') {
        engine.cast('fireball');
      } else if (e.key === '2') {
        engine.cast('frostbolt');
      } else if (e.key === '3') {
        engine.cast('lightning');
      } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        const state = engine.getState();
        if (state.state === 'playing') {
          engine.pause();
        } else if (state.state === 'paused') {
          engine.resume();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        const state = engine.getState();
        if (state.state === 'gameover' || state.state === 'victory') {
          engine.start();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleStart = () => {
    engine.start();
  };

  const handlePause = () => {
    const state = engine.getState();
    if (state.state === 'playing') {
      engine.pause();
    } else if (state.state === 'paused') {
      engine.resume();
    }
  };

  const handleRestart = () => {
    engine.start();
  };

  const handleCast = (spellId: SpellId) => {
    engine.cast(spellId);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 select-none">
      <h1 className="text-2xl font-bold text-purple-300 mb-4 font-mono">
        🧙 Маг на тропе
      </h1>

      <div className="relative" style={{ width: '800px', maxWidth: '100%' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={450}
          className="border-2 border-purple-700 rounded-lg shadow-lg shadow-purple-900/50 w-full"
          style={{ imageRendering: 'auto' }}
        />

        {/* Spell buttons overlay at bottom */}
        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-3">
          <SpellButton
            label="🔥 Огненный шар"
            hotkey="1"
            cooldown={cooldowns.fireball}
            maxCooldown={0.6}
            manaCost={10}
            currentMana={mana}
            onClick={() => handleCast('fireball')}
            disabled={gameState !== 'playing'}
          />
          <SpellButton
            label="❄️ Ледяная стрела"
            hotkey="2"
            cooldown={cooldowns.frostbolt}
            maxCooldown={1.5}
            manaCost={15}
            currentMana={mana}
            onClick={() => handleCast('frostbolt')}
            disabled={gameState !== 'playing'}
          />
          <SpellButton
            label="⚡ Молния"
            hotkey="3"
            cooldown={cooldowns.lightning}
            maxCooldown={3.0}
            manaCost={25}
            currentMana={mana}
            onClick={() => handleCast('lightning')}
            disabled={gameState !== 'playing'}
          />
        </div>

        {/* Menu Overlay */}
        {gameState === 'menu' && (
          <Overlay>
            <h2 className="text-4xl font-bold text-purple-300 mb-4 font-mono">🧙 Маг на тропе</h2>
            <p className="text-gray-300 mb-2 text-center">Защити тропу от монстров!</p>
            <p className="text-gray-400 text-sm mb-6 text-center max-w-md">
              Используй заклинания: <span className="text-orange-400">1</span> - Огненный шар,{' '}
              <span className="text-blue-400">2</span> - Ледяная стрела,{' '}
              <span className="text-yellow-400">3</span> - Молния
            </p>
            <button
              onClick={handleStart}
              className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-lg transition-colors font-mono cursor-pointer"
            >
              ▶ Начать игру
            </button>
          </Overlay>
        )}

        {/* Paused Overlay */}
        {gameState === 'paused' && (
          <Overlay>
            <h2 className="text-3xl font-bold text-yellow-300 mb-4 font-mono">⏸ Пауза</h2>
            <p className="text-gray-300 mb-6">Нажми Esc или P чтобы продолжить</p>
            <button
              onClick={handlePause}
              className="px-6 py-2 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-lg transition-colors font-mono cursor-pointer"
            >
              Продолжить
            </button>
          </Overlay>
        )}

        {/* Game Over Overlay */}
        {gameState === 'gameover' && (
          <Overlay>
            <h2 className="text-4xl font-bold text-red-400 mb-4 font-mono">💀 Поражение</h2>
            <p className="text-gray-300 mb-2">Счёт: <span className="text-yellow-300 font-bold">{score}</span></p>
            <p className="text-gray-400 mb-6">Волна: {wave}/3</p>
            <button
              onClick={handleRestart}
              className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-lg transition-colors font-mono cursor-pointer"
            >
              🔄 Начать заново (R)
            </button>
          </Overlay>
        )}

        {/* Victory Overlay */}
        {gameState === 'victory' && (
          <Overlay>
            <h2 className="text-4xl font-bold text-green-400 mb-4 font-mono">🏆 Победа!</h2>
            <p className="text-gray-300 mb-2">Все волны пройдены!</p>
            <p className="text-yellow-300 text-xl mb-6 font-bold">Счёт: {score}</p>
            <button
              onClick={handleRestart}
              className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-lg transition-colors font-mono cursor-pointer"
            >
              🔄 Играть снова (R)
            </button>
          </Overlay>
        )}
      </div>

      {/* Controls info */}
      <div className="mt-4 text-gray-500 text-sm font-mono text-center">
        <p>1 - Огненный шар | 2 - Ледяная стрела | 3 - Молния | Esc/P - Пауза | R - Рестарт</p>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center rounded-lg backdrop-blur-sm">
      {children}
    </div>
  );
}

function SpellButton({
  label,
  hotkey,
  cooldown,
  maxCooldown,
  manaCost,
  currentMana,
  onClick,
  disabled,
}: {
  label: string;
  hotkey: string;
  cooldown: number;
  maxCooldown: number;
  manaCost: number;
  currentMana: number;
  onClick: () => void;
  disabled: boolean;
}) {
  const isOnCooldown = cooldown > 0;
  const notEnoughMana = currentMana < manaCost;
  const isDisabled = disabled || isOnCooldown || notEnoughMana;
  const cooldownPercent = isOnCooldown ? (cooldown / maxCooldown) * 100 : 0;

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`relative px-3 py-2 rounded-lg font-mono text-xs font-bold transition-all overflow-hidden min-w-[90px]
        ${isDisabled
          ? 'bg-gray-700/90 text-gray-500 cursor-not-allowed'
          : 'bg-indigo-700/90 hover:bg-indigo-600 text-white cursor-pointer active:scale-95 shadow-lg shadow-indigo-900/50'
        }`}
      title={`${label} (${manaCost} маны, КД: ${maxCooldown}с)`}
    >
      {isOnCooldown && (
        <div
          className="absolute inset-0 bg-black/60 transition-all"
          style={{ width: `${cooldownPercent}%` }}
        />
      )}
      <span className="relative z-10">
        <span className="block whitespace-nowrap">{label}</span>
        <span className="block text-[10px] opacity-70">[{hotkey}] {manaCost}💧</span>
      </span>
    </button>
  );
}
