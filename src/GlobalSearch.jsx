import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from './supabase.js';

const emptyResults = { drivers: [], teams: [], cars: [], circuits: [] };

function driverImage(driver) {
  const images = [...(driver.driver_images || [])].sort((a, b) => Number(b.year) - Number(a.year));
  const latest = images.find(image => image.card_url || image.pole_url || image.grid_url);
  return latest?.card_url || latest?.pole_url || latest?.grid_url || '';
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const handleShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === 'Escape') {
        setResults(null);
        setError('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const search = async event => {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) {
      setResults(emptyResults);
      setError('Enter at least 2 characters.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const pattern = `%${term}%`;
      const [drivers, teams, cars, circuits] = await Promise.all([
        sb.from('drivers').select('id,name,code,driver_images(year,card_url,pole_url,grid_url)').ilike('name', pattern).order('name').limit(5),
        sb.from('teams').select('id,name,logo_normal').ilike('name', pattern).order('name').limit(5),
        sb.from('cars').select('id,model,year,image_url,teams(name,logo_normal)').ilike('model', pattern).order('year', { ascending: false }).limit(5),
        sb.from('races').select('circuit,country,circuit_image_url,year').ilike('circuit', pattern).order('year', { ascending: false }).limit(30)
      ]);
      const failure = [drivers.error, teams.error, cars.error, circuits.error].find(Boolean);
      if (failure) throw failure;
      const uniqueCircuits = [...new Map((circuits.data || []).filter(row => row.circuit)
        .map(row => [row.circuit, row])).values()].slice(0, 5);
      setResults({
        drivers: drivers.data || [],
        teams: teams.data || [],
        cars: cars.data || [],
        circuits: uniqueCircuits
      });
    } catch (searchError) {
      setResults(null);
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setResults(null);
    setError('');
  };
  const hasResults = results && Object.values(results).some(items => items.length);
  const showResults = loading || error || results;

  return <form className="global-search" role="search" onSubmit={search}>
    <label className="visually-hidden" htmlFor="global-search-input">Search drivers, teams, cars, and circuits</label>
    <input ref={inputRef} id="global-search-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Pitwall" aria-keyshortcuts="Control+K Meta+K" aria-expanded={Boolean(showResults)} aria-controls="global-search-results" />
    <button type="submit" aria-label="Search">Search</button>
    {showResults && <div id="global-search-results" className="global-search-results" role="status" aria-live="polite">
      <button type="button" className="global-search-close" onClick={close} aria-label="Close search results">Close</button>
      {loading ? <p>Searching…</p> : error ? <p>{error}</p> : hasResults ? <>
        {results.drivers.length > 0 && <section><h2>Drivers</h2><ul>{results.drivers.map(item => <li key={item.id}><Link className="global-search-result-link" to={`/drivers/${item.id}`} onClick={close}>
          <span className="global-search-thumb">{driverImage(item) && <img src={driverImage(item)} alt="" loading="lazy" />}</span><span><strong>{item.name}</strong><small>{item.code || 'Driver'}</small></span>
        </Link></li>)}</ul></section>}
        {results.teams.length > 0 && <section><h2>Teams</h2><ul>{results.teams.map(item => <li key={item.id}><Link className="global-search-result-link" to={`/teams/${item.id}`} onClick={close}>
          <span className="global-search-thumb">{item.logo_normal && <img src={item.logo_normal} alt="" loading="lazy" />}</span><span><strong>{item.name}</strong><small>Constructor</small></span>
        </Link></li>)}</ul></section>}
        {results.cars.length > 0 && <section><h2>Cars</h2><ul>{results.cars.map(item => <li key={item.id}><Link className="global-search-result-link" to={`/cars?filter=${encodeURIComponent(item.model)}`} onClick={close}>
          <span className="global-search-thumb">{item.image_url ? <img src={item.image_url} alt="" loading="lazy" /> : item.teams?.logo_normal && <img src={item.teams.logo_normal} alt="" loading="lazy" />}</span><span><strong>{item.year} · {item.model}</strong><small>{item.teams?.name || 'Car archive'}</small></span>
        </Link></li>)}</ul></section>}
        {results.circuits.length > 0 && <section><h2>Circuits</h2><ul>{results.circuits.map(item => <li key={item.circuit}><Link className="global-search-result-link" to={`/circuits/${encodeURIComponent(item.circuit)}`} onClick={close}>
          <span className="global-search-thumb">{item.circuit_image_url && <img src={item.circuit_image_url} alt="" loading="lazy" />}</span><span><strong>{item.circuit}</strong><small>{item.country || 'Circuit'}</small></span>
        </Link></li>)}</ul></section>}
      </> : <p>No matching drivers, teams, cars, or circuits.</p>}
    </div>}
  </form>;
}