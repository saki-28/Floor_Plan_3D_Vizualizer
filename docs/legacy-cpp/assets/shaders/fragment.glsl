#version 330 core

out vec4 FragColor;

in vec3 FragPos;
in vec3 Normal;
in vec2 TexCoord;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uViewPos;
uniform int uRenderMode; // 0 = Shaded, 1 = Normal Vectors, 2 = Depth Buffer

void main() {
    if (uRenderMode == 1) {
        // Visualize surface normal directions as RGB
        vec3 nColor = normalize(Normal) * 0.5 + 0.5;
        FragColor = vec4(nColor, 1.0);
        return;
    }

    if (uRenderMode == 2) {
        // Visualize linearized depth
        float depth = gl_FragCoord.z;
        FragColor = vec4(vec3(depth), 1.0);
        return;
    }

    // Directional Light + Blinn-Phong
    vec3 norm = normalize(Normal);
    vec3 lightDir = normalize(-uLightDir);
    vec3 viewDir = normalize(uViewPos - FragPos);
    vec3 halfwayDir = normalize(lightDir + viewDir);

    // 1. Ambient Term
    vec3 ambient = 0.25 * uColor;

    // 2. Diffuse Lambertian Term
    float diff = max(dot(norm, lightDir), 0.0);
    vec3 diffuse = diff * uColor * 0.75;

    // 3. Specular Highlight Term
    float spec = pow(max(dot(norm, halfwayDir), 0.0), 32.0);
    vec3 specular = vec3(0.2) * spec;

    vec3 result = ambient + diffuse + specular;
    FragColor = vec4(result, 1.0);
}
