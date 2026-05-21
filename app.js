(function(){
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js');
  }

  function rawNum(v) {
    var s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function fmtCurrency(n) {
    if (n === '' || n == null || isNaN(n)) return '';
    var num = Number(n);
    var sign = num < 0 ? '-' : '';
    return sign + '$' + Math.abs(num).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function fmtCurrency2(n) {
    if (n === '' || n == null || isNaN(n)) return '';
    var num = Number(n);
    var sign = num < 0 ? '-' : '';
    return sign + '$' + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n === '' || n == null || isNaN(n)) return '';
    return n + '%';
  }
  function fmtDscr(n) {
    if (n === '' || n == null || isNaN(n) || !isFinite(n)) return '';
    return Number(n).toFixed(2) + 'x';
  }

  function setupFormatters() {
    document.querySelectorAll('[data-fmt]').forEach(function(el){
      var fmt = el.dataset.fmt;
      el.addEventListener('focus', function(){ el.value = el.value.replace(/[^0-9.\-]/g, ''); });
      el.addEventListener('blur', function(){
        var raw = rawNum(el.value);
        if (el.value === '' || el.value === '-' ) { recompute(); return; }
        if (fmt === 'currency') el.value = fmtCurrency(raw);
        else if (fmt === 'percent') el.value = fmtPct(raw);
        recompute();
      });
      el.addEventListener('input', recompute);
    });
  }

  // Set an input's value from an auto-calc result, but respect user overrides.
  // Field stays sticky once the user types in it; clearing the field resumes auto-calc.
  function setComputed(el, value) {
    if (el.dataset.userEdited !== '1' || el.value === '') {
      el.value = value;
      el.dataset.userEdited = '';
    }
  }

  // Parse "RP0.03-BP3.00" (or any order/case, with or without dashes) → 3.03 (percent).
  function parseRiskPricing(s) {
    s = String(s || '');
    var rp = s.match(/RP\s*([\d.]+)/i);
    var bp = s.match(/BP\s*([\d.]+)/i);
    return (rp ? parseFloat(rp[1]) || 0 : 0) + (bp ? parseFloat(bp[1]) || 0 : 0);
  }

  // "30 Years" → 360 months. "15 Years" → 180. "360 months" → 360.
  function parseTermMonths(s) {
    s = String(s || '');
    var m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return 360;
    var n = parseFloat(m[1]);
    if (/month/i.test(s)) return n;
    return n * 12;
  }

  // Standard amortizing P&I: P × (r/12) × (1+r/12)^n / ((1+r/12)^n − 1)
  function calcMonthlyPI(principal, annualRatePct, months) {
    if (!(principal > 0) || !(annualRatePct > 0) || !(months > 0)) return 0;
    var r = annualRatePct / 100 / 12;
    var factor = Math.pow(1 + r, months);
    return principal * r * factor / (factor - 1);
  }

  function recompute() {
    var loanAmount = rawNum(document.getElementById('f_loanAmount').value);
    var rate = rawNum(document.getElementById('f_interestRate').value);
    var termMonths = parseTermMonths(document.getElementById('f_term').value);
    var propertyValue = rawNum(document.getElementById('f_propertyValue').value);
    var tia = rawNum(document.getElementById('f_tia').value);
    var grossRent = rawNum(document.getElementById('f_grossRent').value);

    // Monthly P&I from amortization formula.
    var monthly = calcMonthlyPI(loanAmount, rate, termMonths);
    var monthlyStr = monthly > 0 ? fmtCurrency2(monthly) : '—';

    // Mirror Loan Amount / Interest Rate / Monthly Payment into the metrics row spans.
    document.getElementById('m_loanAmount').textContent = loanAmount > 0 ? fmtCurrency(loanAmount) : '—';
    document.getElementById('m_interestRate').textContent = rate > 0 ? fmtPct(rate) : '—';
    document.getElementById('m_monthly').textContent = monthlyStr;
    document.getElementById('m_monthlyTerms').textContent = monthlyStr;

    // LTV = Loan Amount / Property Value (sticky in metric row, can override).
    setComputed(document.getElementById('m_ltv'),
      propertyValue > 0 ? ((loanAmount / propertyValue) * 100).toFixed(1) + '%' : '—');

    // NOI = Gross Rent − TIA (sticky in DSCR analysis input).
    if (grossRent > 0 || tia > 0) {
      setComputed(document.getElementById('f_noi'), fmtCurrency(grossRent - tia));
    }
    var noi = rawNum(document.getElementById('f_noi').value);

    // PITIA = P&I + TIA (sticky in DSCR analysis input).
    if (monthly > 0 || tia > 0) {
      setComputed(document.getElementById('f_pitia'), fmtCurrency2(monthly + tia));
    }

    // DSCR = NOI / P&I (sticky in metrics; mirrored into analysis span).
    var dscrStr;
    if (monthly > 0 && noi !== 0) {
      dscrStr = fmtDscr(noi / monthly);
    } else {
      dscrStr = '—';
    }
    setComputed(document.getElementById('m_dscr'), dscrStr);
    document.getElementById('m_dscrAnalysis').textContent = dscrStr;

    // Points = Loan Amount × (RP% + BP%) (sticky once user edits).
    var rpBpPct = parseRiskPricing(document.getElementById('f_riskPricing').value);
    if (rpBpPct > 0 && loanAmount > 0) {
      setComputed(document.getElementById('f_totalPoints'), fmtCurrency(loanAmount * rpBpPct / 100));
    }

    // Total Fees = Processing + Underwriting + Points.
    var tp = rawNum(document.getElementById('f_totalPoints').value);
    var pf = rawNum(document.getElementById('f_processingFee').value);
    var uf = rawNum(document.getElementById('f_underwritingFee').value);
    document.getElementById('m_totalFees').textContent = fmtCurrency(tp + pf + uf) || '—';

    // Total Misc = sum of misc fees.
    var lf = rawNum(document.getElementById('f_legalFee').value);
    var ss = rawNum(document.getElementById('f_servicingSetup').value);
    var sif = rawNum(document.getElementById('f_situsFee').value);
    var dp = rawNum(document.getElementById('f_docPrepFee').value);
    var cw = rawNum(document.getElementById('f_courierFee').value);
    document.getElementById('m_totalMisc').textContent = fmtCurrency(lf + ss + sif + dp + cw) || '—';
  }

  // Inputs that auto-fill but stick once the user types in them.
  // Empty value re-enables auto-calc.
  var COMPUTED_IDS = ['m_ltv', 'm_dscr', 'f_noi', 'f_pitia', 'f_totalPoints'];
  COMPUTED_IDS.forEach(function(id){
    var el = document.getElementById(id);
    el.addEventListener('input', function(){
      el.dataset.userEdited = el.value === '' ? '' : '1';
    });
  });

  // LTV is bidirectional: typing in LTV drives Loan Amount.
  // newLoanAmount = LTV% × PropertyValue
  document.getElementById('m_ltv').addEventListener('input', function(){
    var el = document.getElementById('m_ltv');
    if (el.value === '') { recompute(); return; }
    var ltvPct = rawNum(el.value);
    var propertyValue = rawNum(document.getElementById('f_propertyValue').value);
    if (ltvPct > 0 && propertyValue > 0) {
      document.getElementById('f_loanAmount').value = fmtCurrency(ltvPct * propertyValue / 100);
    }
    recompute();
  });

  // riskPricing has no data-fmt, but changes to it must drive the totalPoints calc.
  document.getElementById('f_riskPricing').addEventListener('input', recompute);
  // term has no data-fmt either, but it drives the amortization calc.
  document.getElementById('f_term').addEventListener('input', recompute);

  function todayFormatted() {
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var d = new Date();
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  var DEFAULTS = {
    date: todayFormatted(), reference: 'TS-626064', riskPricing: 'RP0.03-BP3.00',
    primaryBorrower: 'Keith Brewley', creditScore: '782', experience: 'Experienced',
    borrowerType: 'US Citizen/Resident', propertyMgmt: 'Self-Managed',
    address: '6249 Homer St', cityState: 'Philadelphia, PA 19144',
    propertyType: 'Single Family', units: '1', loanPurpose: 'Cash-Out Refinance',
    program: '1-4 DSCR', loanAmount: 135000, interestRate: 6.38,
    term: '30 Years', amortization: '30-Year Amortizing',
    maxLtv: 75.00, prepayment: '5 Years',
    propertyValue: 300000, tia: 175,
    minDscr: '1.00x', grossRent: 1950, noi: 1775, pitia: 1017.22,
    totalPoints: 4097, processingFee: 595, underwritingFee: 1495,
    legalFee: 1100, servicingSetup: 30, situsFee: 70, docPrepFee: 990, courierFee: 180
  };

  var DEFAULT_TERMS = [
    'Loan Type: 30-year fixed or 30-year with interest-only period',
    'Amortization: 30-year amortizing or interest-only for initial period',
    'Prepayment: 5 years penalty, declining schedule',
    'Borrowing Entity: LLC, LP, or Corporation domiciled in the United States',
    'Personal Guarantee: Required from managing members with aggregate 51% ownership'
  ];

  var DEFAULT_NOTICE = "This letter is merely a general proposal, and is neither a binding offer, nor a contract. Borrower understands that no such offer will be forthcoming prior to completion of appropriate due diligence and underwriting performed and/or contracted by Lender. This proposal does not create any legally binding obligations on any party hereto. All properties are subject to satisfactory Lender due diligence underwriting including: satisfactory appraisal, satisfactory credit review of the borrowing entity and Key Principals, and satisfactory review of the property's market and submarket.";

  function applyValues(obj) {
    Object.keys(obj).forEach(function(k){
      var el = document.getElementById('f_' + k);
      if (!el) return;
      var fmt = el.dataset.fmt;
      var val = obj[k];
      if (val === '' || val == null) { el.value = ''; return; }
      if (fmt === 'currency') el.value = fmtCurrency(val);
      else if (fmt === 'percent') el.value = fmtPct(val);
      else el.value = val;
    });
    recompute();
  }

  function clearMetricOverrides() {
    COMPUTED_IDS.forEach(function(id){
      document.getElementById(id).dataset.userEdited = '';
    });
  }

  function loadDefault() {
    clearMetricOverrides();
    applyValues(DEFAULTS);
    DEFAULT_TERMS.forEach(function(t, i){
      var el = document.querySelector('[data-term="'+i+'"]');
      if (el) el.value = t;
    });
    document.getElementById('f_notice').value = DEFAULT_NOTICE;
    setStatus('Sample values restored.');
  }

  function loadBlank() {
    clearMetricOverrides();
    var blank = {};
    Object.keys(DEFAULTS).forEach(function(k){ blank[k] = ''; });
    applyValues(blank);
    document.querySelectorAll('[data-term]').forEach(function(el){ el.value = ''; });
    document.getElementById('f_notice').value = '';
    setStatus('Blank version loaded — fill in your fields.');
  }

  function setStatus(msg) {
    var s = document.getElementById('upstatus');
    if (s) s.textContent = msg;
    if (msg) setTimeout(function(){ if (s && s.textContent === msg) s.textContent = ''; }, 6000);
  }

  function extractFields(text) {
    text = text.replace(/\s+/g, ' ');
    function get(re) { var m = text.match(re); return m ? m[1].trim() : null; }
    function getNum(re) { var m = text.match(re); return m ? parseFloat(m[1].replace(/,/g, '')) : null; }
    return {
      date: get(/Date:\s*([A-Za-z]+\s+\d+,\s*\d{4})/),
      reference: get(/Reference:\s*([\w\-]+)/),
      riskPricing: get(/(RP[\d.]+-BP[\d.]+)/),
      primaryBorrower: get(/Primary Borrower:\s*(.+?)\s+Credit Score:/),
      creditScore: get(/Credit Score:\s*(\d+)/),
      experience: get(/Experience Level:\s*(.+?)\s+Borrower Type:/),
      borrowerType: get(/Borrower Type:\s*(.+?)\s+(?:Property Management|Property Information|Address:)/),
      propertyMgmt: get(/Property Management:\s*(.+?)\s+(?:Property Information|Address:)/),
      address: get(/Address:\s*(.+?)\s+City,?\s*State:/),
      cityState: get(/City,?\s*State:\s*(.+?)\s+Property Type:/),
      propertyType: get(/Property Type:\s*(.+?)\s+Units:/),
      units: get(/Units:\s*(\d+)/),
      loanPurpose: get(/Loan Purpose:\s*(.+?)\s+(?:Key Loan|LTV|Loan Amount|Program)/),
      program: get(/Program\s+(.+?)\s+Loan Amount/),
      loanAmount: getNum(/Loan Amount\s*\$?([\d,]+(?:\.\d+)?)/),
      interestRate: getNum(/Interest Rate\s*([\d.]+)\s*%/),
      term: get(/\bTerm\s+(\d+\s*(?:Years?|Months?))/i),
      amortization: get(/Amortization\s+(.+?)\s+(?:Max LTV|Monthly Payment|Prepayment)/),
      maxLtv: getNum(/Max LTV\s*([\d.]+)\s*%/),
      prepayment: get(/Prepayment Penalty\s+(.+?)\s+(?:DSCR Analysis|Monthly Gross Rent|Fees)/),
      grossRent: getNum(/Monthly Gross Rent\s*\$?([\d,]+(?:\.\d+)?)/),
      noi: getNum(/\bNOI\s*\$?([\d,]+(?:\.\d+)?)/),
      pitia: getNum(/Monthly PITIA\s*\$?([\d,]+(?:\.\d+)?)/),
      totalPoints: getNum(/\bPoints\s*\$?([\d,]+(?:\.\d+)?)/),
      processingFee: getNum(/Processing Fee\s*\$?([\d,]+(?:\.\d+)?)/),
      underwritingFee: getNum(/Underwriting Fee\s*\$?([\d,]+(?:\.\d+)?)/),
      legalFee: getNum(/Legal Fee\s*\$?([\d,]+(?:\.\d+)?)/),
      servicingSetup: getNum(/Servicing Set Up\s*\$?([\d,]+(?:\.\d+)?)/),
      situsFee: getNum(/Situs Ordering Fee\s*\$?([\d,]+(?:\.\d+)?)/),
      docPrepFee: getNum(/Document Prep Fee\s*\$?([\d,]+(?:\.\d+)?)/),
      courierFee: getNum(/Courier\s*(?:&|and|&amp;)\s*Wire Fee\s*\$?([\d,]+(?:\.\d+)?)/)
    };
  }

  async function handlePdf(file) {
    setStatus('Reading PDF...');
    try {
      if (typeof pdfjsLib === 'undefined') { setStatus('PDF library not loaded yet — try again in a moment.'); return; }
      var ab = await file.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      var text = '';
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var content = await page.getTextContent();
        text += content.items.map(function(it){ return it.str; }).join(' ') + ' ';
      }
      var fields = extractFields(text);
      var found = {};
      Object.keys(fields).forEach(function(k){ if (fields[k] !== null && fields[k] !== '') found[k] = fields[k]; });
      applyValues(found);
      setStatus('Loaded ' + Object.keys(found).length + ' fields from PDF.');
    } catch (e) {
      setStatus('Error reading PDF: ' + e.message);
    }
  }

  function sanitize(s) {
    return String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  }

  function downloadAsPdf() {
    var ref = sanitize(document.getElementById('f_reference').value) || 'Untitled';
    var borrower = sanitize(document.getElementById('f_primaryBorrower').value);
    var parts = ['DSCR Term Sheet', ref];
    if (borrower && borrower !== 'TBD') parts.push(borrower);
    var filename = parts.join(' - ');

    var originalTitle = document.title;
    document.title = filename;
    setStatus('Opening print dialog — choose "Save as PDF" as the destination.');
    window.addEventListener('afterprint', function restore() {
      document.title = originalTitle;
      window.removeEventListener('afterprint', restore);
    });
    window.print();
  }

  document.getElementById('btnReload').addEventListener('click', loadDefault);
  document.getElementById('btnBlank').addEventListener('click', loadBlank);
  document.getElementById('btnUpload').addEventListener('click', function(){
    document.getElementById('pdfup').click();
  });
  document.getElementById('btnDownload').addEventListener('click', downloadAsPdf);

  var fi = document.getElementById('pdfup');
  fi.addEventListener('change', function(e){
    var f = e.target.files && e.target.files[0];
    if (f) handlePdf(f);
    e.target.value = '';
  });

  setupFormatters();
  document.getElementById('f_date').value = todayFormatted();
  recompute();
})();
