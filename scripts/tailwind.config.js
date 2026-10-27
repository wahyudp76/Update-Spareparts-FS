module.exports = {
  content: ['./index.html','./app.js'],
  safelist: [
    {pattern:/^(bg|text)-(red|slate|emerald|indigo|blue|sky|amber|orange|green|purple|pink|fuchsia|cyan|violet|rose|teal|lime|yellow)-(50|100|200|300|400|500|600|700|800|900)$/},
    {pattern:/^(border)-(red|slate|emerald|indigo|blue|sky|amber|orange|green|purple|pink)-(100|200|300|400|500|600)$/},
  ],
  theme:{extend:{
    fontFamily:{sans:['Inter','sans-serif'],display:['Space Grotesk','sans-serif']},
    colors:{
      brand:{50:'#f0f9ff',100:'#e0f2fe',500:'#0ea5e9',600:'#0284c7',700:'#0369a1',800:'#075985'},
      ok:{500:'#10b981',600:'#059669'}, warn:{500:'#f59e0b',600:'#d97706'}, bad:{500:'#ef4444',600:'#dc2626'},
    }}},
  corePlugins:{preflight:true}
};
