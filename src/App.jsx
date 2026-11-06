import {useEffect,useState} from 'react';
import {Routes,Route,NavLink,useLocation} from 'react-router-dom';
import {Home,Drivers,Driver,Cars,Teams,Team,Grids,Races,RaceDetail,Circuits,Circuit,Results,Simulate} from './Pages.jsx';
import Admin from './Admin.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import './navigation.css';
const sections=[
 ['Championship',[['/drivers','Drivers'],['/teams','Teams']]],
 ['Cars & Circuits',[['/cars','Cars'],['/circuits','Circuits']]],
 ['Race Center',[['/grids','Grids'],['/races','Races'],['/results','Results']]],
 ['Simulation',[['/simulate','Simulate']]],
 ['Management',[['/admin','Admin']]]
];
function getInitialTheme(){try{return window.localStorage.getItem('pitwall-theme')==='light'?'light':'dark'}catch(error){console.warn('Could not read the saved theme preference:',error);return 'dark'}}
export default function App(){
 const [theme,setTheme]=useState(getInitialTheme);
 const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
 const location=useLocation();
 useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme},[theme]);
 useEffect(()=>{
  if(location.pathname==='/')return;
  const segments=location.pathname.split('/').filter(Boolean);
  const labels={drivers:'Drivers',teams:'Teams',cars:'Cars',grids:'Grids',races:'Races',circuits:'Circuits',results:'Results',simulate:'Simulation',admin:'Admin'};
  const item={path:location.pathname,label:segments.length>1?`${labels[segments[0]]||segments[0]} profile`:labels[segments[0]]||segments[0]};
  try{
   const saved=JSON.parse(window.localStorage.getItem('pitwall-recent-pages')||'[]');
   const recent=[item,...(Array.isArray(saved)?saved:[]).filter(page=>page.path!==item.path)].slice(0,5);
   window.localStorage.setItem('pitwall-recent-pages',JSON.stringify(recent));
  }catch(error){console.warn('Could not update recently viewed pages:',error)}
 },[location.pathname]);
 const toggleTheme=()=>setTheme(current=>{
  const next=current==='dark'?'light':'dark';
  try{window.localStorage.setItem('pitwall-theme',next)}catch(error){console.warn('Could not save the theme preference:',error)}
  return next;
 });
 return <>
 <header className="app-header">
  <NavLink to="/" className="app-brand" onClick={()=>setMobileMenuOpen(false)}>Pitwall</NavLink>
  <button type="button" className="mobile-menu-toggle" aria-expanded={mobileMenuOpen} aria-controls="primary-navigation" onClick={()=>setMobileMenuOpen(open=>!open)}>{mobileMenuOpen?'Close':'Menu'}</button>
  <nav id="primary-navigation" className={`primary-nav${mobileMenuOpen?' is-open':''}`} aria-label="Main navigation">
   {sections.map(([label,links])=>{
    const active=links.some(([path])=>location.pathname===path||location.pathname.startsWith(`${path}/`));
    return <details className="nav-section" key={label}>
     <summary className={active?'active':''}>{label}</summary>
     <div className="nav-section-links">{links.map(([path,title])=><NavLink key={path} to={path} onClick={()=>setMobileMenuOpen(false)}>{title}</NavLink>)}</div>
    </details>;
   })}
  </nav>
  <div className="header-actions">
   <GlobalSearch />
   <button type="button" className="theme-toggle" onClick={toggleTheme} aria-pressed={theme==='dark'} aria-label={`Switch to ${theme==='dark'?'light':'dark'} theme`}>{theme==='dark'?'Light theme':'Dark theme'}</button>
  </div>
 </header>
 <main><Routes><Route path="/" element={<Home/>}/><Route path="/drivers" element={<Drivers/>}/><Route path="/drivers/:id" element={<Driver/>}/>
 <Route path="/cars" element={<Cars/>}/><Route path="/teams" element={<Teams/>}/><Route path="/teams/:id" element={<Team/>}/>
 <Route path="/grids" element={<Grids/>}/><Route path="/races" element={<Races/>}/><Route path="/races/:id" element={<RaceDetail/>}/><Route path="/circuits" element={<Circuits/>}/><Route path="/circuits/:name" element={<Circuit/>}/><Route path="/results" element={<Results/>}/><Route path="/simulate" element={<Simulate/>}/><Route path="/admin" element={<Admin/>}/></Routes></main></>}
