import {Routes,Route,NavLink} from 'react-router-dom';
import {Home,Drivers,Driver,Cars,Teams,Team,Grids,Races,Simulate} from './Pages.jsx';
import Admin from './Admin.jsx';
const links=[['/drivers','Drivers'],['/teams','Teams'],['/cars','Cars'],['/grids','Grids'],['/races','Races'],['/simulate','Simulate'],['/admin','Admin']];
export default function App(){return <>
 <header className="nav"><NavLink to="/" className="logo">Pitwall</NavLink><nav>{links.map(([to,l])=><NavLink key={to} to={to}>{l}</NavLink>)}</nav></header>
 <main><Routes><Route path="/" element={<Home/>}/><Route path="/drivers" element={<Drivers/>}/><Route path="/drivers/:id" element={<Driver/>}/>
 <Route path="/cars" element={<Cars/>}/><Route path="/teams" element={<Teams/>}/><Route path="/teams/:id" element={<Team/>}/>
 <Route path="/grids" element={<Grids/>}/><Route path="/races" element={<Races/>}/><Route path="/simulate" element={<Simulate/>}/><Route path="/admin" element={<Admin/>}/></Routes></main></>}
