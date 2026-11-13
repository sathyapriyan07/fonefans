import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from './supabase.js';

const emptyResults = { drivers: [], teams: [], cars: [], circuits: [] };

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        sb.from('drivers').select('id,name,code').ilike('name', pattern).order('name').limit(5),
        sb.from('teams').select('id,name').ilike('name', pattern).order('name').limit(5),
        sb.from('cars').select('id,model,year').ilike('model', pattern).order('year', { ascending: false }).limit(5),
        sb.from('races').select('circuit,year').ilike('circuit', pattern).order('year', { ascending: false }).limit(30)
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

  return <form className="global-search" role="search" onSubmit={search}>
    <label className="visually-hidden" htmlFor="global-search-input">Search drivers, teams, cars, and circuits</label>
    <input id="global-search-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Pitwall" />
    <button type="submit" aria-label="Search">Search</button>
    {(loading || error || results) && <div className="global-search-results" role="status" aria-live="polite">
      <button type="button" className="global-search-close" onClick={close} aria-label="Close search results">Close</button>
      {loading ? <p>Searching…</p> : error ? <p>{error}</p> : hasResults ? <>
        {results.drivers.length > 0 && <section><h2>Drivers</h2><ul>{results.drivers.map(item => <li key={item.id}><Link to={`/drivers/${item.id}`} onClick={close}>{item.name}{item.code ? ` · ${item.code}` : ''}</Link></li>)}</ul></section>}
        {results.teams.length > 0 && <section><h2>Teams</h2><ul>{results.teams.map(item => <li key={item.id}><Link to={`/teams/${item.id}`} onClick={close}>{item.name}</Link></li>)}</ul></section>}
        {results.cars.length > 0 && <section><h2>Cars</h2><ul>{results.cars.map(item => <li key={item.id}><Link to={`/cars?filter=${encodeURIComponent(item.model)}`} onClick={close}>{item.year} · {item.model}</Link></li>)}</ul></section>}
        {results.circuits.length > 0 && <section><h2>Circuits</h2><ul>{results.circuits.map(item => <li key={item.circuit}><Link to={`/circuits/${encodeURIComponent(item.circuit)}`} onClick={close}>{item.circuit}</Link></li>)}</ul></section>}
      </> : <p>No matching drivers, teams, cars, or circuits.</p>}
    </div>}
  </form>;
}