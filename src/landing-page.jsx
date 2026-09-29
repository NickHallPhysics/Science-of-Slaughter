import { Link } from 'react-router-dom';

// Add future phases here as they're built — each becomes a button on the
// landing page automatically. Set enabled: false for a phase that's
// planned but not ready yet, and it'll render as a disabled placeholder
// instead of a link.
const PHASES = [
  {
    id: 'shooting',
    label: 'Shooting Phase - vs Infantry',
    path: '/shootingInfantry',
    description: 'Hit, wound, save, and casualty probabilities for ranged attacks against Infantry in the Attack Sub-Phase.',
    enabled: true,
  },
  {
    id: 'assault',
    label: 'Assault Phase - vs Infantry',
    path: '/assaultInfantry',
    description: 'Hit, wound, save, and casualty probabilities for close combat attacks against Infantry in the Fight Sub-Phase.',
    enabled: true,
  },
  {
    id: 'shootingVehicles',
    label: 'Shooting Phase - vs Vehicles',
    path: '/shootingVehicles',
    description: 'Hit, wound, save, and casualty probabilities for ranged attacks against Vehicles in the Attack Sub-Phase.',
    enabled: false,
  },
  {
    id: 'challenge',
    label: 'Challenge Sub-Phase',
    path: '/challenge',
    description: 'Hit, wound, and save for challenges between champions.',
    enabled: false,
  },
];

export default function HomePage() {
  return (
    <div className="landing">
      <Link to="/about" className="landing-button landing-button-small about-button">
        <span className="landing-button-label">About</span>
      </Link>

      <div className="landing-content">
        <p className="landing-eyebrow">A Combat Probability Toolkit</p>
        <h1 className="landing-banner">Science of Slaughter</h1>
        <p className="landing-subtitle">
          Probability distributions for every phase for the 3rd Edition of the Horus 
          Heresy to help you make decisions with the tactical insight of one of the 
          tech-savants of the Mechanicum.
        </p>

        <div className="landing-buttons">
          {PHASES.map((phase) =>
            phase.enabled ? (
              <Link key={phase.id} to={phase.path} className="landing-button">
                <span className="landing-button-label">{phase.label}</span>
                <span className="landing-button-desc">{phase.description}</span>
              </Link>
            ) : (
              <div key={phase.id} className="landing-button landing-button-disabled" aria-disabled="true">
                <span className="landing-button-label">{phase.label} <em>— Coming Soon</em></span>
                <span className="landing-button-desc">{phase.description}</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
