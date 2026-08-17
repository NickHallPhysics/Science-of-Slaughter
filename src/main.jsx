import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './landing-page.jsx';
import ShootingInfantryPage from './shooting/shootingInfantry-page.jsx';
import AssaultInfantryPage from './assault/assaultInfantry-page.jsx';
import AboutPage from './about-page.jsx';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/shootingInfantry" element={<ShootingInfantryPage />} />
        <Route path="/assaultInfantry" element={<AssaultInfantryPage />} />
        <Route path="/about" element={<AboutPage />} />
     </Routes>
    </HashRouter>
  </React.StrictMode>
);
