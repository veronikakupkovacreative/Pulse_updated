/* ---------- Odchycení reálného souboru (Drag & Drop + klik) ---------- */
  let currentFile = null; 
  var dz = $('#drop');

  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, x => { 
      x.preventDefault(); 
      dz.classList.add('is-dragover'); 
  }));

  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, x => { 
      x.preventDefault(); 
      dz.classList.remove('is-dragover'); 
      if (ev === 'drop' && x.dataTransfer.files.length > 0) { 
          currentFile = x.dataTransfer.files[0];
          setTrack(true); 
          location.hash = '#/analyzer'; 
      } 
  }));

  // Otevření systémového okna po kliknutí na Dropzone
  dz.addEventListener('click', () => {
      let input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.onchange = e => {
          if (e.target.files.length > 0) {
              currentFile = e.target.files[0];
              setTrack(true);
              location.hash = '#/analyzer';
          }
      };
      input.click();
  });

  /* ---------- Reálné API volání pro Analyzer ---------- */
  async function runAnalysis() {
    if (!currentFile) return;
    
    $('#an-run').hidden = false; 
    $('#an-done').hidden = true;
    
    const formData = new FormData();
    // Klíč 'file' nebo 'audio' musí odpovídat tomu, co očekává tvůj api.py
    formData.append('file', currentFile); 

    try {
        // Změň '/api/analyze' na přesný endpoint z tvého server.py
        const response = await fetch('/api/analyze', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Chyba při komunikaci se serverem.');
        
        // Očekávaný formát z Pythonu: {"bpm": 124, "key": "A minor", ...}
        const data = await response.json();
        
        // Zápis reálných dat z backendu do UI (uprav selektory podle tvé struktury)
        $('.metric--hot b').textContent = data.bpm || '--';
        $$('.metric b')[1].textContent = data.key || '--';
        $$('.metric b')[2].textContent = data.camelot || '--';
        
        $('#an-run').hidden = true; 
        $('#an-done').hidden = false;
        drawBeat(); 
    } catch (err) {
        toast("Analýza selhala: " + err.message);
        $('#an-run').hidden = true;
    }
  }

  function setTrack(v) {
    document.body.dataset.track = v ? 'loaded' : 'none';
    if (v) runAnalysis();
  }
