// Un recolector de piezas: junta muchas cajas, cilindros y rampas en una sola geometría con color por vértice. Así toda la
// parte estática de la bodega (piso, racks, estructura, bandas) se dibuja con unas pocas mallas en lugar de miles.
//
// Recibe la librería Three.js por parámetro (se carga con import() dinámico), no la importa.

export class PartCollector {
  constructor(THREE) {
    this.THREE = THREE;
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
    this.color = new THREE.Color();
  }

  get vertex_count() {
    return this.positions.length / 3;
  }

  push_face(corners, normal, color) {
    const base = this.vertex_count;
    this.color.set(color);
    corners.forEach((corner) => {
      this.positions.push(corner[0], corner[1], corner[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(this.color.r, this.color.g, this.color.b);
    });
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Una caja con orientación libre: `center` y tres vectores de medio lado (hacia +x, +y y +z locales)
  add_oriented_box(center, half_x, half_y, half_z, color) {
    const corner = (sign_x, sign_y, sign_z) => [
      center[0] + sign_x * half_x[0] + sign_y * half_y[0] + sign_z * half_z[0],
      center[1] + sign_x * half_x[1] + sign_y * half_y[1] + sign_z * half_z[1],
      center[2] + sign_x * half_x[2] + sign_y * half_y[2] + sign_z * half_z[2],
    ];
    const unit = (vector) => {
      const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
      return [vector[0] / length, vector[1] / length, vector[2] / length];
    };
    const ux = unit(half_x);
    const uy = unit(half_y);
    const uz = unit(half_z);
    const negate = (vector) => [-vector[0], -vector[1], -vector[2]];
    // Cada cara con sus cuatro esquinas en sentido antihorario visto desde afuera
    this.push_face([corner(1, -1, 1), corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1)], ux, color);
    this.push_face([corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1)], negate(ux), color);
    this.push_face([corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), corner(-1, 1, -1)], uy, color);
    this.push_face([corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1)], negate(uy), color);
    this.push_face([corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)], uz, color);
    this.push_face([corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1)], negate(uz), color);
  }

  // Una caja alineada con los ejes, centrada en (cx, cy, cz), con giro opcional alrededor de y
  add_box(cx, cy, cz, size_x, size_y, size_z, color, rotation_y = 0) {
    const cos = Math.cos(rotation_y);
    const sin = Math.sin(rotation_y);
    this.add_oriented_box(
      [cx, cy, cz],
      [(size_x / 2) * cos, 0, (-size_x / 2) * sin],
      [0, size_y / 2, 0],
      [(size_z / 2) * sin, 0, (size_z / 2) * cos],
      color,
    );
  }

  // Una barra entre dos puntos, con `width` de ancho (horizontal) y `thickness` de grueso: sirve para bandas, rampas y rieles
  add_beam(from, to, width, thickness, color) {
    const along = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(along[0], along[1], along[2]);
    if (length < 1e-6) return;
    const direction = [along[0] / length, along[1] / length, along[2] / length];
    // El lado de la barra: perpendicular a la dirección sobre el plano horizontal (o x si la barra es vertical)
    let side = [-direction[2], 0, direction[0]];
    const side_length = Math.hypot(side[0], side[2]);
    side = side_length < 1e-6 ? [1, 0, 0] : [side[0] / side_length, 0, side[2] / side_length];
    // El "arriba" de la barra: perpendicular a la dirección y al lado
    const up = [
      side[1] * direction[2] - side[2] * direction[1],
      side[2] * direction[0] - side[0] * direction[2],
      side[0] * direction[1] - side[1] * direction[0],
    ];
    // Si el "arriba" calculado apunta hacia abajo se invierte, y el lado con él, para que la terna siga siendo directa
    // (si no, las caras quedarían al revés y desaparecerían por el recorte de caras traseras)
    const flip = up[1] < 0 ? -1 : 1;
    const center = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    this.add_oriented_box(
      center,
      [direction[0] * (length / 2), direction[1] * (length / 2), direction[2] * (length / 2)],
      [up[0] * flip * (thickness / 2), up[1] * flip * (thickness / 2), up[2] * flip * (thickness / 2)],
      [side[0] * flip * (width / 2), side[1] * flip * (width / 2), side[2] * flip * (width / 2)],
      color,
    );
  }

  // Un cilindro vertical (columnas, postes, tanques)
  add_cylinder(cx, cy, cz, radius_top, radius_bottom, height, color, segments = 10) {
    const geometry = new this.THREE.CylinderGeometry(radius_top, radius_bottom, height, segments);
    geometry.translate(cx, cy, cz);
    this.append_geometry(geometry, color);
    geometry.dispose();
  }

  // Un cilindro acostado cuyo eje va a lo largo de z (ruedas de camiones y montacargas)
  add_cylinder_z(cx, cy, cz, radius, length, color, segments = 12) {
    const geometry = new this.THREE.CylinderGeometry(radius, radius, length, segments);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(cx, cy, cz);
    this.append_geometry(geometry, color);
    geometry.dispose();
  }

  append_geometry(geometry, color) {
    const base = this.vertex_count;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    this.color.set(color);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      this.positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      this.normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
      this.colors.push(this.color.r, this.color.g, this.color.b);
    }
    for (let position_index = 0; position_index < index.count; position_index += 1) {
      this.indices.push(base + index.getX(position_index));
    }
  }

  build() {
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute("position", new this.THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new this.THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new this.THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
