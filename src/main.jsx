import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './landing-page.jsx';
import ShootingPage from './shooting/shooting-page.jsx';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/shooting" element={<ShootingPage />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
