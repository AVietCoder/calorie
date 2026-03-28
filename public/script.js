async function callApi() {
  try {
    const res = await fetch("/api/hello");
    const data = await res.json();
    document.getElementById("result").innerText = data.message;
  } catch (err) {
    document.getElementById("result").innerText =
      "Không gọi được API";
  }
}
