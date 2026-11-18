// Base de colaboradores 100% fictícia, no mesmo formato da planilha real (sra_feedback.xlsx).
// Usada nos testes do repositório, que não podem conter nomes nem CPFs reais.
const PRIMEIROS = ['ANA', 'BRUNO', 'CARLA', 'DIEGO', 'ELISA', 'FABIO', 'GABRIELA', 'HUGO', 'IRIS', 'JONAS', 'KATIA', 'LUCAS',
  'MARINA', 'NELSON', 'OLGA', 'PEDRO', 'QUITERIA', 'RENATO', 'SILVIA', 'TIAGO', 'URSULA', 'VITOR', 'WANDA', 'XAVIER', 'YARA'];
const SOBRENOMES = ['ALVES', 'BARROS', 'CAMPOS', 'DANTAS', 'ESTEVES', 'FARIAS', 'GUSMAO', 'HOLANDA', 'IGLESIAS', 'JARDIM', 'LACERDA', 'MACHADO'];

function cpf(base9) {
  const d = String(base9).padStart(9, '0').slice(0, 9).split('').map(Number);
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i);
    d.push(((s * 10) % 11) % 10);
  }
  const x = d.join('');
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

function baseFicticia() {
  const COORD = 'COORDENADOR DELTA DE SA SOUZA';
  const supervisores = [
    { mat: '101', nome: 'SUPERVISOR ALFA SANTOS', cc: 'IRE LET', equipe: 20, ccEquipe: 'IRE LET GPB' },
    { mat: '102', nome: 'SUPERVISORA BETA LIMA', cc: 'ITA ADM LOCAL STC', equipe: 15, ccEquipe: 'ITA STC' },
    { mat: '103', nome: 'SUPERVISOR GAMA ROCHA', cc: 'IRE ADM LOCAL STC', equipe: 10, ccEquipe: 'IRE STC' }
  ];
  const linhas = [['Matricula', 'Descrição C.C', 'Liderança', 'Nome complet', 'C.P.F.']];
  const cpfs = {};
  let seq = 7;
  const add = (mat, cc, lider, nome) => {
    // alguns CPFs começam com zero, como acontece na base real
    const c = cpf(seq % 4 === 0 ? (seq * 104729) % 100000000 : 100000000 + seq * 7919);
    seq++;
    cpfs[mat] = c;
    linhas.push([Number(mat), cc, lider, nome, c]);
  };
  supervisores.forEach((s) => add(s.mat, s.cc, COORD, s.nome));
  add('104', 'IRE ADM LOCAL REH', COORD, 'ANALISTA EPSILON RAMOS');
  add('105', 'ITA ADM LOCAL', COORD, 'ASSISTENTE ZETA MOURA');
  let mat = 1000, k = 0;
  supervisores.forEach((s) => {
    s.membros = [];
    for (let i = 0; i < s.equipe; i++) {
      mat++;
      const nome = `${PRIMEIROS[k % PRIMEIROS.length]} ${SOBRENOMES[(k * 5) % SOBRENOMES.length]} ${SOBRENOMES[(k * 7 + 3) % SOBRENOMES.length]}`;
      k++;
      add(String(mat), s.ccEquipe, s.nome, nome);
      s.membros.push(String(mat));
    }
  });
  return { linhas, cpfs, coord: COORD, supervisores, total: linhas.length - 1 };
}

module.exports = { baseFicticia, cpf };
