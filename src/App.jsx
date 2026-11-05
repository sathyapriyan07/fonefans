import {useEffect,useState} from 'react';
import {Routes,Route,NavLink} from 'react-router-dom';
import {Home,Drivers,Driver,Cars,Teams,Team,Grids,Races,Circuits,Circuit,Results,Simulate} from './Pages.jsx';
import Admin from './Admin.jsx';
const links=[['/drivers','Drivers'],['/teams','Teams'],['/cars','Cars'],['/grids','Grids'],['/races','Races'],['/circuits','Circuits'],['/results','Results'],['/simulate','Simulate'],['/admin','Admin']];
function getInitialTheme(){try{return window.localStorage.getItem('pitwall-theme')==='dark'?'dark':'light'}catch(error){console.warn('Could not read the saved theme preference:',error);return 'light'}}
export default function App(){
 const [theme,setTheme]=useState(getInitialTheme);
 useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme},[theme]);
 const toggleTheme=()=>setTheme(current=>{
  const next=current==='dark'?'light':'dark';
  try{window.localStorage.setItem('pitwall-theme',next)}catch(error){console.warn('Could not save the theme preference:',error)}
  return next;
 });
 return <>
 <header className="nav"><NavLink to="/" className="logo">Pitwall</NavLink><nav>{links.map(([to,l])=><NavLink key={to} to={to}>{l}</NavLink>)}</nav><button type="button" className="theme-toggle" onClick={toggleTheme} aria-pressed={theme==='dark'} aria-label={`Switch to ${theme==='dark'?'light':'dark'} theme`}>{theme==='dark'?'Light theme':'Dark theme'}</button></header>
 <main><Routes><Route path="/" element={<Home/>}/><Route path="/drivers" element={<Drivers/>}/><Route path="/drivers/:id" element={<Driver/>}/>
 <Route path="/cars" element={<Cars/>}/><Route path="/teams" element={<Teams/>}/><Route path="/teams/:id" element={<Team/>}/>
 <Route path="/grids" element={<Grids/>}/><Route path="/races" element={<Races/>}/><Route path="/circuits" element={<Circuits/>}/><Route path="/circuits/:name" element={<Circuit/>}/><Route path="/results" element={<Results/>}/><Route path="/simulate" element={<Simulate/>}/><Route path="/admin" element={<Admin/>}/></Routes></main></>}
