import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import readmeContent from '../ABOUT.md?raw';

export default function AboutPage() {
  return (
    <div className="landing">
      <Link to="/" className="landing-button landing-button-small back-home-button">
        <span className="landing-button-label">&larr; Home</span>
      </Link>

      <div className="landing-content about-content">
        <div className="markdown-content">
          <ReactMarkdown>{readmeContent}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
