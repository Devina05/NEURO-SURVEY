const API = window.location.origin + "/api";
function setToken(t){
  localStorage.setItem("token", t);
}

function getToken(){
  return localStorage.getItem("token");
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + localStorage.getItem("token")
  };
}
