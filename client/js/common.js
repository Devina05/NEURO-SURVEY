const API = "http://localhost:4000/api";

function setToken(t){
  localStorage.setItem("token", t);
}

function getToken(){
  return localStorage.getItem("token");
}

function authHeaders(){
  const t = getToken();
  return t 
    ? { "Content-Type": "application/json", "Authorization": "Bearer " + t }
    : { "Content-Type": "application/json" };
}
